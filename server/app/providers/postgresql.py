# -*- coding: utf-8 -*-

"""
A data provider that interacts with a　PostgreSQL database using SQLAlchemy's　
ORM　functionality.
"""
import contextlib

import sqlalchemy
import sqlalchemy.orm
import sqlalchemy.orm.exc
import sqlalchemy.exc
import sqlalchemy.dialects

import app.config
import app.exceptions
import app.util
import app.logger
from app.providers.template import DataProvider
from app.providers.util import SQLAlchemyORM

Base = SQLAlchemyORM.Base
Paper = SQLAlchemyORM.Paper
Sentence = SQLAlchemyORM.Sentence
Context = SQLAlchemyORM.Context
Grounding = SQLAlchemyORM.Grounding
GroundingText = SQLAlchemyORM.GroundingText
Event = SQLAlchemyORM.Event
Comment = SQLAlchemyORM.Comment

logger = app.logger.getLogger(__name__)


class PostgresProvider(DataProvider):
    """
    Client request functions return an error message on Exceptions;
    Simple functions simply reraise them.
    """

    ##########################
    # Startup/Shutdown/Admin #
    ##########################
    def __init__(self, connection_string):
        super().__init__(connection_string)
        self.connection_string = connection_string

        # Prep the DB connection
        self.engine = sqlalchemy.create_engine(
            "postgresql://{}".format(connection_string)
        )
        self.engine.connect()
        self.execute_literal("SET SCHEMA '{}';".format(
            app.config.db_vars["postgres_schema"]))

        # ... and the ORM session
        self.session = sqlalchemy.orm.sessionmaker(bind=self.engine)()
        logger.info(
            "PostgreSQL data provider initialised. ({0})".format(
                self.connection_string)
        )

    def shutdown(self):
        self.session.commit()
        self.session.close()
        logger.info("PostgreSQL data provider shut down.")

    def execute_literal(self, query):
        """
        Executes a literal sql query on the DB.
        Bypasses the ORM, so results (if any) are tuples.
        """
        # Escape the SQL Query
        query = sqlalchemy.text(query)

        results = []
        try:
            with self.engine.begin() as connection:
                raw = connection.execute(query)
                if raw.returns_rows:
                    results = raw.fetchall()

            return results
        except Exception as e:
            logger.debug(repr(e))
            raise e

    ####################################
    # Data retrieval (Client requests) #
    ####################################
    def get_paper_list(self, request):
        # Gets data for the paper selection table. 'request' should follow
        # the DataTables API: https://datatables.net/manual/server-side
        try:
            response = {}
            response['draw'] = int(request['draw'])
            response['recordsTotal'] = int(self.count_papers())

            query = self.session.query(
                Paper.id, Paper.title,
                sqlalchemy.sql.expression.func.to_char(
                    Paper.last_modified,
                    app.config.db_vars["timestamp_format"]
                ),
                Paper.locked,
                Paper.annotation_pass
            )

            # Do we need to filter on anything?
            search_str = request['search']['value']
            logger.debug(search_str)
            if search_str != "":
                query = query.filter(
                    (Paper.id.ilike('%{}%'.format(search_str))) |
                    (Paper.title.ilike('%{}%'.format(search_str))) |
                    (sqlalchemy.sql.expression.func.to_char(
                        Paper.last_modified,
                        app.config.db_vars["timestamp_format"]
                    ).ilike('%{}%'.format(search_str)))
                )

            # (Multi-column) Ordering?
            for multi_index in request['order']:
                order_index = multi_index['column']
                order_dir = multi_index['dir']
                order_classes = [Paper.id, Paper.title, Paper.last_modified,
                                 Paper.locked]
                order_column = order_classes[order_index]
                if order_dir == "asc":
                    order_column = order_column.asc()
                elif order_dir == "desc":
                    order_column = order_column.desc()
                query = query.order_by(order_column)

            # Debug log the compiled query
            logger.debug(
                str(
                    query.statement.compile(
                        dialect=sqlalchemy.dialects.postgresql.dialect()
                    )
                )
            )

            # Slicing?
            # Take the whole slice from the requested start record, and pare it
            # down if needed
            slice_start = int(request['start'])
            slice_length = int(request['length'])
            query = query[slice_start:]
            if slice_length != -1:
                query = query[:slice_length]

            # Change locked value from true/false to Y/N
            for index, row in enumerate(query):
                row = list(row)
                if not row[3]:
                    row[3] = "N"
                else:
                    row[3] = "Y"
                query[index] = row

            response['data'] = query
            return response
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def get_paper_data(self, request):
        # Prepares all the data for the requested paper in a nice format for
        # the client
        try:
            paper_id = request['paperID']
            paper_model = self.get_paper_by_id(paper_id)

            return_data = {}
            return_data['paper'] = {}
            return_data['paper']['id'] = paper_model.id
            return_data['paper']['title'] = paper_model.title
            return_data['paper']['sections'] = paper_model.sections
            # The following query returns a list of 1-tuples as its result
            sentences = self.session.query(Sentence.sentence) \
                            .filter(Sentence.paper == paper_model) \
                            .order_by(Sentence.line_num)[:]
            return_data['paper']['sentences'] = [x[0] for x in sentences]
            return_data['paper']['locked'] = paper_model.locked
            return_data['paper']['annotation_pass'] = \
                paper_model.annotation_pass

            # "xia" type contexts are from the curated TSVs, but should not
            # be deleteable like "manual" ones.
            contexts_reach = self.session.query(Context) \
                                 .filter(Context.paper == paper_model) \
                                 .filter(
                sqlalchemy.or_(Context.type == "reach",
                               Context.type == "xia")
            ) \
                                 .order_by(Context.id)[:]
            return_data['contexts_reach'] = [x.dictionary for x in
                                             contexts_reach]

            contexts_manual = self.session.query(Context) \
                                  .filter(Context.paper == paper_model) \
                                  .filter(Context.type == "manual") \
                                  .order_by(Context.id)[:]
            return_data['contexts_manual'] = [x.dictionary for x in
                                              contexts_manual]

            # Context category hierarchy
            # [ ( <description>, [ <prefix>, ... ] ) ]
            return_data['context_categories'] = \
                app.config.context_categories

            # Events are ordered by line_num, then by interval_start
            events = self.session.query(Event) \
                .filter(Event.paper == paper_model)

            # If we are in annotation pass 1, we will not send Reach events.
            # if paper_model.annotation_pass == 1:
            #     events = events.filter(Event.type != "reach")

            events = events.order_by(Event.line_num) \
                         .order_by(Event.interval_start)[:]
            return_data['events'] = [x.dictionary for x in events]

            return return_data

        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": "Could not load the requested paper.<br>"
                           "Please select another one from the list of "
                           "available papers."
            }

    def get_comments(self, paper_id):
        """
        Returns the given paper's current comments as a String
        """
        try:
            paper = self.get_paper_by_id(paper_id)
            comment_get = self._get_one_or_create(Comment,
                                                  paper=paper)
            comment = comment_get[0]

            if not comment_get[1]:
                comment.comment = ""
                logger.debug("Created empty comment string for paper (ID: {})"
                             "".format(paper_id))

            # comment is a Comment object, which stores the paper's comment
            # string in its 'comment' attribute
            return {
                'comment': comment.comment
            }

        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": "Error getting comments for the current paper ({})"
                           "".format(paper_id)
            }

    def get_paper_diff(self, request):
        """
        Returns information about the difference between the current
        annotations and the default annotations for the given paper

        Rough algorithm (to be implemented):
        0) [All comparisons are between the base Reach/manual annotations and
           the current state of the database.]
        1) Simple attributes on the main Paper object are compared and marked
           either 'unchanged' or 'updated'.
        2) Set attributes ('.contexts', '.events', etc.) are turned into Lists
           for dumping to JSON later.  Each set element should be a Namespace
           object.
        3) Namespace objects within these sets are matched based on their
           simple attributes (line_num, interval_start, etc.).  If there are
           no matches, the objects are saved as 'created' or 'deleted'
           accordingly.
        4) For objects that do match, any set attributes they have (e.g.,
           the 'groundings' property for the events Namespace) are further
           compared (again, based on simple attributes), and marked as either
           'created', 'deleted', or 'unchanged' accordingly.

                 /-- id: String
                 |-- title: {'unchanged'/'updated', String}
                 |-- sections: {'unchanged'/'updated', String}
                 |-- locked: {'unchanged'/'updated', Boolean}
        -- Paper +
                 |-- sentences: Dict +-- created: List +-- paper_id
                 |                   |                 |-- line_num
                 |                   |                 \-- sentence
                 |                   |
                 |                   |-- deleted: List +-- paper_id
                 |                   |                 |-- line_num
                 |                   |                 \-- sentence
                 |                   |
                 |                   \-- matched: List +-- paper_id
                 |                                     |-- line_num
                 |                                     \-- sentence
                 |
                 |-- contexts: Dict +-- created: List +-- paper_id
                 |                  |                 |-- line_num
                 |                  |                 |-- interval_start
                 |                  |                 |-- interval_end
                 |                  |                 |-- type
                 |                  |                 |-- free_text
                 |                  |                 \-- grounding_id
                 |                  |
                 |                  |-- deleted: List +-- [As above]
                 |                  \-- matched: List +-- [As above]
                 |
                 \-- events: Dict +-- created: List +-- paper_id
                                  |                 |-- line_num
                                  |                 |-- interval_start
                                  |                 |-- interval_end
                                  |                 |-- type
                                  |                 |
                                  |                 \-- groundings: Dict (
                                  below)
                                  |
                                  |-- deleted: List +-- [As above]
                                  \-- matched: List +-- [As above]

        * Sentences, contexts, and events are matched based on their simple
          attributes.
        * Only events have an additional complex attribute, 'groundings'
        * Under normal circumstances, we should not expect changes to either
          the simple attributes of Paper or the elements in 'sentences'
          * We generally expect three kinds of changes: Adding event-grounding
            associations, removing these associations, and adding new manual
            contexts.

        =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

        [Paper.events.groundings is a set]
        \-- groundings: Dict +-- created: List +-- id
                             |
                             |-- deleted: List +-- id
                             |
                             \-- matched: List +-- id

        * For created events, all the groundings are put in the 'created' list
        * For deleted events, all the groundings are put in the 'deleted' list

        """
        try:
            paper_id = request['paperID']
            # Populated from database
            current_paper = self.get_paper_by_id(paper_id)
            # Populated from paper directory
            base_paper = self._read_paper(paper_id)

            return_data = {}
            return_data['same'] = {}
            return_data['diff'] = {}
            return_data['added'] = {}
            return_data['removed'] = {}

            def iterate_diff(attribute_path, iterable):
                """
                Iterates over the given (sub-)object from self._read_paper(),
                pushing values that are different to 'diff' and values that
                are the same to 'same' in return_data
                """
                # Namespace and Dictionary objects
                if (isinstance(iterable, app.util.Namespace) or
                        isinstance(iterable, dict)):

                    try:
                        dictionary = vars(iterable)
                    except TypeError:
                        # Dictionary objects don't allow vars(), strangely
                        # enough
                        dictionary = iterable

                    for key, base_item in dictionary.items():
                        if (isinstance(base_item, app.util.Namespace) or
                                isinstance(base_item, dict) or
                                isinstance(base_item, set)):
                            # Recurse
                            iterate_diff(attribute_path + [key], base_item)
                        else:
                            # Simple attribute; find the current value and
                            # compare it
                            current_item = current_paper
                            for path in attribute_path:
                                current_item = getattr(current_item, path)
                            current_item = getattr(current_item, key)

                            if current_item == base_item:
                                diff_item = return_data['same']
                            else:
                                diff_item = return_data['diff']

                            for path in attribute_path:
                                if path not in diff_item:
                                    diff_item[path] = {}

                                diff_item = diff_item[path]

                            diff_item[key] = current_item

                            logger.info('Handling simple attribute: {}, {}'
                                        ''.format(key,
                                                  current_item))

                elif isinstance(iterable, set):
                    # There isn't an easy way to compare sets; we'll have to
                    # iterate repeatedly :(

                    # Cast to Lists for our return data (sets cannot be
                    # dumped as JSON)
                    same_set = return_data['same']
                    for path in attribute_path[:-1]:
                        same_set = same_set[path]
                    same_set[attribute_path[-1]] = []
                    same_set = same_set[attribute_path[-1]]

                    diff_set = return_data['diff']
                    for path in attribute_path[:-1]:
                        diff_set = diff_set[path]
                    diff_set[attribute_path[-1]] = []
                    diff_set = diff_set[attribute_path[-1]]

                    # Get the current data for this set from the database
                    current_set = current_paper
                    for path in attribute_path:
                        current_set = getattr(current_set, path)

                    # Perform the comparison
                    for current_item in current_set:
                        found_same = False
                        # Uses the custom .dictionary property we put on our
                        # ORM objects
                        current_vars = current_item.dictionary

                        for base_item in iterable:
                            assert (isinstance(base_item, app.util.Namespace))
                            is_same = True
                            base_vars = vars(base_item)

                            # if attribute_path == ['contexts']:
                            #     print("====")
                            #     print(current_vars)
                            #     print("----")
                            #     print(base_vars)

                            for key, item in base_vars.items():
                                if isinstance(item, set):
                                    # An embedded set
                                    current_vars[key] = list(current_vars[key])
                                    if not set_same(item, current_vars[key]):
                                        is_same = False

                                # Cast everything to strings for the comparison
                                # (_read_paper returns strings, the ORM
                                # objects cast to int per the DB schema)
                                elif str(current_vars[key]) != str(item):
                                    is_same = False

                            if is_same:
                                # Found a member in current_set that matches
                                found_same = True
                                break

                        if found_same:
                            same_set.append(current_vars)
                        else:
                            diff_set.append(current_vars)

            def set_same(base_set, current_set):
                """
                Recursively checks a set of Namespaces from base_paper to
                see if they hold the same values as a set from current_paper
                (This simpler check is used for embedded sets, since we won't
                have to push these embedded sets to "same"/"diff")
                """
                # Base cases: When the length of the subsets are different,
                # or when both are empty
                if len(base_set) != len(current_set):
                    return False

                if len(base_set) == 0 and len(current_set) == 0:
                    return True

                # If the number of items is the same, make sure that the
                # items are the same as well
                for base_item in base_set:
                    assert (isinstance(base_item, app.util.Namespace))
                    found_same = False
                    base_vars = vars(base_item)

                    for current_item in current_set:
                        is_same = True
                        current_vars = current_item.dictionary

                        for key, item in base_vars.items():
                            if isinstance(item, set):
                                current_vars[key] = list(current_vars[key])
                                if not set_same(item, current_vars[key]):
                                    is_same = False
                            elif str(current_vars[key]) != str(item):
                                is_same = False

                        if is_same:
                            found_same = True
                            break

                    if not found_same:
                        return False

            iterate_diff([], base_paper)

            return return_data

        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": "Could not read the requested paper.<br>"
                           "Please select another one from the list of "
                           "available papers."
            }

    ###########################
    # Data retrieval (Simple) #
    ###########################
    def count_papers(self):
        """
        Returns a count of the number of unique papers being tracked in the
        databases
        """
        return self.session.query(Paper).count()

    def get_paper_by_id(self, paper_id):
        """
        Searches for and returns the Paper with the given ID.
        Unlike _get_one_or_create(), does not attempt to create the Paper if
        it does not exist.
        """
        try:
            return self.session.query(Paper) \
                .filter_by(id=paper_id).one()
        except Exception as e:
            logger.error("Error when attempting to look up Paper (ID: {})."
                         .format(paper_id))
            logger.error(repr(e))
            raise e

    def get_event_by_id(self, event_id):
        """
        Searches for and returns the Event with the given ID.
        Unlike _get_one_or_create(), does not attempt to create the Event if
        it does not exist.
        """
        try:
            return self.session.query(Event) \
                .filter_by(id=event_id).one()
        except Exception as e:
            logger.error("Error when attempting to look up Event (ID: {})."
                         .format(event_id))
            logger.error(repr(e))
            raise e

    def get_events_by_line(self, paper_id, line_num):
        """
        Return a List of the Events on a given line in a given paper
        """
        try:
            return self.session.query(Event) \
                .filter_by(paper_id=paper_id, line_num=line_num)
        except Exception as e:
            logger.error(repr(e))
            raise e

    def get_grounding_by_id(self, grounding_id):
        """
        Searches for and returns the Grounding with the given ID.
        Unlike _get_one_or_create(), does not attempt to create the
        Grounding if
        it does not exist.
        """
        try:
            return self.session.query(Grounding) \
                .filter_by(id=grounding_id).one()
        except Exception as e:
            logger.error("Error when attempting to look up Grounding (ID: {})."
                         .format(grounding_id))
            logger.error(repr(e))
            raise e

    def get_grounding_text_by_text(self, free_text):
        """
        Searches for and returns the GroundingText with the given text.
        Unlike _get_one_or_create(), does not attempt to create the
        GroundingText if it does not exist.
        Unlike the other gets, returns False if the GroundingText could not
        be found.
        """
        try:
            return self.session.query(GroundingText) \
                .filter_by(free_text=free_text).one()
        except Exception as e:
            logger.debug(
                "Error when attempting to look up GroundingText (Text: {})."
                "".format(free_text))
            logger.debug(repr(e))
            return False

    def get_manual_groundings(self):
        """
        Returns a list of Grounding objects that have an automatically
        generated ID (i.e., they were added manually by the user).
        Each Grounding object has a `grounding_texts` attribute listing
        the GroundingTexts that reference it, and an `events` attribute that
        holds the Set of Event objects that are associated with it.
        """
        return self.session.query(Grounding).filter(
            Grounding.id.ilike('manual:%')
        )[:]

    #######################################
    # Data manipulation (Client requests) #
    #######################################
    def second_annotation_pass(self, paper_id):
        """
        Activates the second annotation pass for the given paper, if possible.
        [Annotation passes]
        Pass 1: Reach events are not shown, and annotators are asked to
        identify as many manual events as possible.
        Pass 2: Reach events are displayed, with overlaps handled
        appropriately. Annotators are asked to identify false positives.
        """
        try:
            paper = self.get_paper_by_id(paper_id)
            if paper.annotation_pass != 1:
                # Malformed request from the client -- The paper is already
                # in the second pass
                return {
                    "error":   True,
                    "message": "The selected paper already seems to have its "
                               "second annotation pass activated. Please try "
                               "refreshing the page."
                }
            else:
                paper.annotation_pass = 2
                self.session.commit()

                # Also do some pre-processing: We want Reach events to
                # inherit the context associations for any manual events they
                # overlap. (Although the user is free to change them later,
                # for the most part.)
                manual_events = self.session.query(Event) \
                                    .filter(Event.paper == paper) \
                                    .filter(Event.type == "manual")[:]

                for manual_event in manual_events:
                    # Search for reach events on the same line
                    reach_events = \
                        self.session.query(Event) \
                            .filter(Event.paper == paper) \
                            .filter(Event.type == "reach") \
                            .filter(Event.line_num == manual_event.line_num)[:]

                    # Check for overlaps
                    for reach_event in reach_events:
                        overlap = False
                        # Reach event starts in manual event
                        if manual_event.interval_start <= \
                                reach_event.interval_start <= \
                                manual_event.interval_end:
                            overlap = True
                        # Reach event ends in manual event
                        if manual_event.interval_start <= \
                                reach_event.interval_end <= \
                                manual_event.interval_end:
                            overlap = True
                        # Reach event contains manual event
                        if ((reach_event.interval_start <=
                                 manual_event.interval_start)
                            and
                                (manual_event.interval_end <=
                                     reach_event.interval_end)):
                            overlap = True

                        if overlap:
                            logger.debug(
                                "Line {}: Found overlap between Reach "
                                "event ({}-{}) and manual event "
                                "({}-{}). Reach event inheriting "
                                "manual event's associations."
                                "".format(manual_event.line_num,
                                          reach_event.interval_start,
                                          reach_event.interval_end,
                                          manual_event.interval_start,
                                          manual_event.interval_end))
                            for grounding in manual_event.groundings:
                                self.associate_event_grounding(reach_event,
                                                               grounding)

                return {
                    "paper_id": paper_id
                }
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def create_event(self, paper_id, line_num, interval_start, interval_end,
                     type="manual"):
        """
        Creates the requested event and returns the associated Event object
        Logs to debug if the requested event already exists in the DB
        """
        try:
            assert (type == "reach" or type == "manual")
            event_get = self._get_one_or_create(Event,
                                                line_num=line_num,
                                                interval_start=interval_start,
                                                interval_end=interval_end,
                                                type=type,
                                                paper_id=paper_id)
            if event_get[1]:
                logger.debug(
                    "Asked to create new event ({}:{}:{}-{}), "
                    "but it already exists in the database.".format(
                        paper_id, line_num, interval_start, interval_end
                    )
                )
            else:
                self.session.add(event_get[0])
                self.session.commit()

            return event_get[0].dictionary
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def resize_event(self, event_id, new_start, new_end):
        """
        Resizes the given event
        """
        try:
            event = self.get_event_by_id(event_id)
            event.interval_start = new_start
            event.interval_end = new_end
            self.session.commit()
            return True
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def delete_event(self, paper_id, server_id):
        """
        Deletes the specified manual event from the database
        """
        try:
            event = self.session.query(Event) \
                .filter_by(paper_id=paper_id,
                           id=server_id,
                           type="manual") \
                .one()
            self.session.delete(event)
            self.session.commit()
            return True
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def false_positive(self, paper_id, server_id):
        """
        Toggles the FP status for the given Reach event
        """
        try:
            event = self.session.query(Event) \
                .filter_by(paper_id=paper_id,
                           id=server_id,
                           type="reach") \
                .one()
            event.false_positive = not event.false_positive
            self.session.commit()
            return True
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def create_context(self, paper_id, line_num, interval_start,
                       interval_end, free_text,
                       type="manual", grounding_id=None):
        """
        Creates the requested context and returns the associated Context
        object's dictionary.
        Logs to debug if the requested context already exists in the DB.
        context_type defaults to "manual".
        If grounding_id is not specified, the GroundingText database will be
        queried; if no matching entry is found, a novel grounding_id will be
        created.
        """
        try:
            if grounding_id is None:
                # Try to get a GroundingText
                grounding_text = self.get_grounding_text_by_text(free_text)
                if not grounding_text:
                    # Whoops, couldn't get one.  Generate it.
                    grounding_text = self._generate_grounding_text(free_text)
            else:
                # Grounding ID was specified.  Make sure it exists.
                grounding_get = self._get_one_or_create(Grounding,
                                                        id=grounding_id)
                if not grounding_get[1]:
                    logger.debug(
                        "Created grounding ID by user request: {}".format(
                            grounding_id
                        )
                    )
                grounding = grounding_get[0]

                # Then make sure the free text is mapped to that ID
                grounding_text_get = self._get_one_or_create(
                    GroundingText,
                    free_text=free_text,
                    grounding=grounding
                )
                if not grounding_text_get[1]:
                    logger.debug(
                        "Associated text '{}' with grounding ID: {}"
                        "".format(free_text, grounding.id)
                    )
                grounding_text = grounding_text_get[0]

            # Finally, create the context
            assert (type == "reach" or type == "manual" or
                    type == "xia")
            context_get = self._get_one_or_create(Context,
                                                  line_num=line_num,
                                                  interval_start=interval_start,
                                                  interval_end=interval_end,
                                                  type=type,
                                                  paper_id=paper_id,
                                                  grounding_text=grounding_text)
            if context_get[1]:
                logger.debug(
                    "Asked to create new context ({}:{}:{}-{}), "
                    "but it already exists in the database.".format(
                        paper_id, line_num, interval_start, interval_end
                    )
                )

            self.session.commit()
            return context_get[0].dictionary

        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def delete_context(self, paper_id, server_id):
        """
        Deletes the specified manual context from the database
        """
        try:
            context = self.session.query(Context) \
                .filter_by(paper_id=paper_id,
                           id=server_id,
                           type="manual") \
                .one()
            self.session.delete(context)
            self.session.commit()
            return True
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def associate_event_grounding(self, event, grounding):
        """
        As with all such functions, the arguments passed should be ORM objects
        """
        try:
            event.groundings.add(grounding)
            self.session.commit()
        except Exception as e:
            logger.error(repr(e))
            raise e

    def save_event_contexts(self, event_id, groundings):
        """
        Makes sure that all and only the grounding IDs specified are
        associated with the event specified
        """
        try:
            event = self.get_event_by_id(event_id)
            event.groundings = set()
            for grounding_id in groundings:
                grounding = self.get_grounding_by_id(grounding_id)
                event.groundings.add(grounding)
            self.session.commit()
            return True
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    def save_comments(self, paper_id, comments):
        """
        Sets the comment string for the given paper to the one provided
        """
        try:
            paper = self.get_paper_by_id(paper_id)
            # paper.comment is an ORM Comment object
            paper.comment.comment = comments
            self.session.commit()
            return True
        except Exception as e:
            logger.error(repr(e))
            return {
                "error":   True,
                "message": repr(e)
            }

    ###################
    # Private helpers #
    ###################
    def _create_tables(self):
        """
        DEBUG: Creates the application tables and sets up audit log
        triggers.  Serves as a record of the DB schemata, but should not be
        needed in production.
        The role performing these queries *must* be a superuser, and must have
        create permissions on the application database -- Needless to say,
        a different user should be used on production.
        If the normal app login role is set in db_vars["postgres_login"] in
        app.config, it will be created and any required permissions will be
        granted to it; this function may therefore be run under a separate
        superuser role (e.g., postgres).
        The normal app login role thus created might need extra setup
        (password, pg_hba configuration, etc.) before use.
        """
        from app.providers.postgresql_schema import db_schema

        statements = []
        # Main tables (In specific order to satisfy foreign key constraints)
        statements.append(db_schema["postgres_schema"])
        statements.append(db_schema["grounding_table"])
        statements.append(db_schema["grounding_text_table"])
        statements.append(db_schema["paper_table"])
        statements.append(db_schema["context_table"])
        statements.append(db_schema["event_table"])
        statements.append(db_schema["sentence_table"])
        statements.append(db_schema["association_table"])
        statements.append(db_schema["comment_table"])

        # Audit logs
        statements.append(db_schema["hstore_setup"])
        statements.append(db_schema["audit_setup"])
        statements.append(db_schema["audit_triggers"])

        # App user
        statements.append(db_schema["app_role"])
        statements.append(db_schema["app_permissions"])

        # Paper last modified trigger
        statements.append(db_schema["modified_setup"])
        statements.append(db_schema["modified_triggers"])

        # Execute
        try:
            for statement in statements:
                self.execute_literal(statement)

        except Exception as e:
            logger.debug(repr(e))
            raise e

    def _get_one_or_create(self, model,
                           create_method='',
                           create_method_kwargs=None,
                           **kwargs):
        """
        http://stackoverflow.com/questions/2546207/does-sqlalchemy-have-an
        -equivalent-of-djangos-get-or-create
        True if there was already a matching object in the session/db
        """
        try:
            return self.session.query(model).filter_by(**kwargs).one(), True
        except sqlalchemy.orm.exc.NoResultFound:
            kwargs.update(create_method_kwargs or {})
            try:
                with self.session.begin_nested():
                    created = getattr(model, create_method, model)(**kwargs)
                    self.session.add(created)
                return created, False
            except sqlalchemy.exc.IntegrityError as e:
                logger.debug(repr(e))
                try:
                    return self.session.query(model).filter_by(
                        **kwargs).one(), True
                except sqlalchemy.orm.exc.NoResultFound:
                    logger.error("NoResultFound error when trying to return a "
                                 "result from the database -- A unique/key "
                                 "constraint may have been violated.")
                    raise app.exceptions.CustomError("DBCreateFailed")
                except Exception as e:
                    logger.error(repr(e))
                    raise e

    def _generate_grounding_text(self, free_text):
        """
        The database has no grounding ID associated with the given free_text.
        Manually generate a GroundingText and save it.
        """
        manual_grounding = "manual:{}".format(free_text.replace(" ", "-"))
        grounding_get = self._get_one_or_create(Grounding, id=manual_grounding)
        logger.debug(
            "Created manual grounding ID: {}".format(manual_grounding))
        grounding = grounding_get[0]

        grounding_text_get = self._get_one_or_create(GroundingText,
                                                     free_text=free_text,
                                                     grounding=grounding)
        logger.debug("Associated text '{}' with manual grounding ID {}."
                     "".format(free_text, grounding.id)
                     )
        return grounding_text_get[0]

    @contextlib.contextmanager
    def _app_name(self, app_name):
        """
        Sets the current PostgreSQL application_name -- This shows up in the
        audit log for any changed records.
        """
        # execute_literal returns a list of results; SHOW returns a tuple
        old_name = self.execute_literal("SHOW application_name;")[0][0]
        self.execute_literal("SET application_name TO '{}'".format(app_name))
        yield
        self.execute_literal("SET application_name TO '{}'".format(old_name))

    ################################
    # Data Loading and Maintenance #
    ################################
    def _load_paper(self, paper_id):
        """
        Attempts to read the paper data for the given paper ID
        """
        paper_data = self._read_paper(paper_id)
        if not paper_data:
            logger.error("Could not load paper.")
            return

        self._new_paper(paper_data)

    def _read_paper(self, paper_id):
        """
        Reads the base annotation data for the given paper
        """
        import csv
        import os
        import re

        base = os.path.join(app.config.papers_path, paper_id)
        if not os.path.isdir(base):
            # Two possibilities: There is no such directory, or it was
            # disabled
            disabled_check = os.path.join(app.config.papers_path,
                                          paper_id +
                                          app.config.paper_disabled_suffix)
            if os.path.isdir(disabled_check):
                logger.error("Paper directory is marked as disabled: {}"
                             "".format(disabled_check))
            else:
                logger.error("Could not find paper directory: {}"
                             "".format(base))
            return False

        # -- Paper
        paper = app.util.Namespace()
        paper.id = paper_id

        # -- Sentences
        paper.sentences = set()
        with open(os.path.join(base, 'sentences.txt')) as f:
            # Stripping out extraneous whitespace to prevent problems with
            # intervals
            raw_sentences = [' '.join(line.strip().split()) for line in f]
        for line_num, sentence in enumerate(raw_sentences):
            line = app.util.Namespace()
            line.line_num = line_num
            line.sentence = sentence
            line.paper_id = paper_id
            paper.sentences.add(line)

        # -- Title
        with open(os.path.join(base, 'titles.txt')) as f:
            line_num = 0
            for line in f:
                if line.startswith("true"):
                    break
                line_num += 1
        paper.title = raw_sentences[line_num]

        # -- Sections
        with open(os.path.join(base, 'sections.txt')) as f:
            curr_section = None
            line_num = 0
            section_list = []
            for line in f:
                if line != curr_section:
                    section_list.append(str(line_num))
                    curr_section = line
                line_num += 1
        paper.sections = ",".join(section_list)

        # -- Reach contexts
        paper.contexts = set()

        # The text+grounding part of interval mentions can look like:
        # T-cell[-%]tissuelist:TS-1001
        reach_matcher = re.compile(r"(.+)" +
                                   app.config.mention_intervals_delimiter +
                                   "((" +
                                   app.config.paper_grounding_prefixes +
                                   r"):.+)")
        with open(os.path.join(base, 'mention_intervals.txt')) as f:
            for line in f:
                line = line.strip()
                mentions = line.split()
                if len(mentions) > 1:
                    # There are mentions for this line
                    line_num = mentions[0]
                    for mention in mentions[1:]:
                        # Split into three guaranteed parts: Start index,
                        # end index and free text + grounding ID
                        # (Just in case the free text/grounding ID contains
                        # the delimiter character)
                        intervals = mention.split(
                            app.config.mention_intervals_delimiter,
                            maxsplit=2)
                        interval_start = intervals[0]
                        interval_end = intervals[1]
                        m = reach_matcher.match(intervals[2])

                        m = reach_matcher.match("astrocytes_.%cl:CL:0000127")
                        m = reach_matcher.match("stem_cell%cl:CL:0000034")
                        m = reach_matcher.match("Stem_Cell_Hypothesis%cl:CL:0000034")
                        m = reach_matcher.match("Preadipocyte_Factor%cl:CL:0002334")
                        m = reach_matcher.match("Keratinocyte_Signaling%tissuelist:TS-0500")
                        m = reach_matcher.match("Human_Embryonic%taxonomy:9606")
                        m = reach_matcher.match("THYROID_TUMORS%tissuelist:TS-1047")
                        m = reach_matcher.match("adult_subventricular_zone_astrocytes%uberon:UBERON:0004922")
                        m = reach_matcher.match("glioblastoma_initiating%tissuelist:TS-0417")
                        m = reach_matcher.match("colorectal_cancer_.%tissuelist:TS-0160")
                        m = reach_matcher.match("human_keratinocytes%cellosaurus:CVCL_9T09")
                        m = reach_matcher.match("Adipose_Derived%tissuelist:TS-0013")

                        #m = reach_matcher.match("mammary_epithelial_cells%cl:CL:0002327")
                        #m = reach_matcher.match("breast_carcinoma%tissuelist:TS-0592")
                        # Let's be more aggressive about catching errors here
                        try:
                            assert m
                        except AssertionError:
                            logger.debug("Could not find Regex match on "
                                         "interval mention: {}"
                                         "".format(intervals[2]))
                            raise

                        # if not m:
                        #     logger.debug("Could not find Regex match on "
                        #                  "interval mention: {}"
                        #                  "".format(intervals[2]))
                        #     continue

                        free_text = m.group(1).replace("_", " ")
                        grounding_id = m.group(2)

                        # Create the context
                        context = app.util.Namespace()
                        context.paper_id = paper_id
                        context.line_num = line_num
                        context.interval_start = interval_start
                        context.interval_end = interval_end
                        context.type = "reach"
                        context.free_text = free_text
                        context.grounding_id = grounding_id

                        paper.contexts.add(context)

        # -- Reach events
        paper.events = set()

        with open(os.path.join(base, 'event_intervals.txt')) as f:
            for line in f:
                line = line.strip()
                events = line.split()
                if len(events) > 1:
                    # There are events on this line
                    line_num = events[0]
                    for event in events[1:]:
                        interval_start, interval_end = event.split("-")

                        # Create the event
                        event = app.util.Namespace()
                        event.paper_id = paper_id
                        event.line_num = line_num
                        event.interval_start = interval_start
                        event.interval_end = interval_end
                        event.type = "reach"
                        event.groundings = set()

                        paper.events.add(event)

        # -- Xia's base context associations
        manual_annotation_path = os.path.join(base, paper_id + ".tsv")
        if not (os.path.exists(manual_annotation_path)):
            logger.debug("No manual annotations for {}."
                         "".format(paper_id))
        else:
            with open(os.path.join(base, paper_id + ".tsv"), newline='') as f:
                try:
                    tsv = csv.reader(f, delimiter='\t')
                    # Pass 1: Get all grounding labels
                    # Grounding labels start with S|T|C -- Basically, [^E]
                    annotation_labels = {}
                    for row in tsv:
                        line_num = row[0]
                        groundings = row[1]
                        grounding_labels = row[3]

                        if groundings != "":
                            # There are contexts identified on this line
                            groundings = groundings.split(",")
                            grounding_labels = \
                                grounding_labels.lower().split(",")
                            for grounding_label in grounding_labels:
                                grounding_label = \
                                    grounding_label.strip()
                                if not grounding_label.startswith("e"):
                                    annotation_labels[grounding_label] = \
                                        groundings.pop(0).strip()
                            if len(groundings) > 0:
                                logger.debug("Did not identify labels for all "
                                             "groundings on line {}. "
                                             "Remaining "
                                             "labels: {}"
                                             "".format(line_num, groundings))

                    # Pass 2: Associate events with their contexts by line
                    f.seek(0)
                    for row in tsv:
                        line_num = row[0]
                        associations = row[4]
                        if associations != "":
                            # There are associations on this line
                            associations = associations.lower().split(",")
                            for association in associations:
                                association = association.strip()
                                grounding_id = annotation_labels[association]
                                grounding = app.util.Namespace()
                                grounding.id = grounding_id

                                for event in paper.events:
                                    if event.line_num == line_num:
                                        event.groundings.add(grounding)

                except Exception as e:
                    error_msg = ("Error reading curated TSV for paper: {}.\n"
                                 "Last line was {}.\n"
                                 "{}".format(paper_id, line_num, repr(e)))
                    logger.error(error_msg)

        return paper

    def _new_paper(self, paper):
        """
        Given the output of _read_paper, attempts to create a new paper in
        the database.
        """
        # Application name for audit log
        with self._app_name("_new_paper"):
            # Will be populated as we run into errors, and raised at the end
            errors = []

            # -- Paper
            paper_get = self._get_one_or_create(Paper, id=paper.id)
            if paper_get[1]:
                logger.debug("Paper already exists in the database: {}. It "
                             "must be deleted before it can be loaded again."
                             "".format(paper.id))
                return False
            paper_orm = paper_get[0]

            # -- Sentences
            for sentence in paper.sentences:
                line = self._get_one_or_create(Sentence,
                                               **vars(sentence))[0]
                paper_orm.sentences.add(line)

            # -- Title
            paper_orm.title = paper.title

            # -- Sections
            paper_orm.sections = paper.sections

            # -- Reach contexts
            for context in paper.contexts:
                results = self.create_context(**vars(context))

                if 'error' in results and results["error"]:
                    # We ran into some trouble here.
                    errors.append("Error with context: {} ({})"
                                  "".format(context.free_text,
                                            context.grounding_id))

            # -- Reach events and Xia's base context annotations
            for event in paper.events:
                # The `event` namespace has an extra variable,
                # the `groundings` set, that should not be passed as a
                # keyword argument to self.create_event().
                params = vars(event).copy()
                params.pop('groundings')
                event_orm = self.create_event(**params)

                for grounding in event.groundings:
                    grounding_orm = self.get_grounding_by_id(grounding)

                    self.associate_event_grounding(event_orm, grounding_orm)

            # -- Done
            self.session.commit()
            logger.debug("Done loading paper: {}.".format(paper.id))
            if len(errors) > 0:
                raise app.exceptions.CustomError("\n".join(errors))

    def _delete_paper(self, paper_id):
        """
        Deletes all references to the given paper from the database
        Grounding and GroundingText objects that may have been created for the
        paper will *not* be deleted.
        """
        # Set the application name for the audit log
        with self._app_name("_delete_paper"):
            paper = self.get_paper_by_id(paper_id)

            # -- Sentences
            for sentence in list(paper.sentences):
                self.session.delete(sentence)

            # -- Contexts
            for context in list(paper.contexts):
                self.session.delete(context)

            # -- Events
            for event in list(paper.events):
                event.groundings = set()
                self.session.delete(event)

            # -- Comments
            if paper.comment is not None:
                self.session.delete(paper.comment)

            # -- Paper
            self.session.delete(paper)

            self.session.commit()

    def _load_all_papers(self):
        """
        Loops through `papers_path` (as defined in config.py), loading every
        paper folder that does not end with `paper_disabled_suffix`
        """
        import os

        path = app.config.papers_path
        errors = []
        for root, dirs, files in os.walk(path):
            for directory in dirs:
                directory_path = os.path.join(root, directory)
                if directory_path.endswith(app.config.paper_disabled_suffix):
                    logger.debug("Paper directory is marked as disabled: {}. "
                                 "Skipping.".format(directory_path))
                    continue

                try:
                    self._load_paper(directory)
                except Exception as e:
                    errors.append((directory, repr(e)))

        if len(errors) > 0:
            logger.debug("Errors encountered while loading paper. Listing:")
            for error in errors:
                logger.debug("{}: {}".format(error[0], error[1]))

    def _delete_all_papers(self):
        """
        Deletes all the papers in the database -- Use with caution!
        """
        # Sanity check
        import sys
        if not hasattr(sys, "ps1"):
            # An interactive session was never started -- Presumably we got
            # some unintended client input
            error = "_delete_all_papers() is only available in " \
                    "interactive/debug mode."
            logger.error(error)

            return {
                "error":   True,
                "message": error
            }

        sane = input("Enter 'yes' (in full) to confirm deletion of all "
                     "papers: ")
        if sane != "yes":
            logger.debug("Aborting _delete_all_papers().")
            return

        # Perform the deletion
        paper_list = self.session.query(Paper)[:]
        for paper in paper_list:
            self._delete_paper(paper.id)

    def _load_grounding_dictionaries(self, overwrite=False):
        """
        Reads all the .tsv.gz dictionary files at the path specified in
        app.config.grounding_dictionaries_path, and primes the Grounding and
        GroundingText tables with their entries.

        If overwrite is true, we will delete existing entries on IntegrityError
        """
        import csv
        import gzip
        import os

        # Set the application name for the audit log
        with self._app_name("_load_grounding_dictionaries"):

            # Read grounding prefixes
            grounding_prefixes = {}
            with open(app.config.grounding_dictionary_prefixes, 'r',
                      newline='') as fp:
                tsv = csv.reader(fp, delimiter='\t')
                for filename, prefix in tsv:
                    grounding_prefixes[filename] = prefix

            # Read actual dictionaries
            path = app.config.grounding_dictionaries_path
            for root, dirs, files in os.walk(path):
                for file in files:
                    file_path = os.path.join(root, file)
                    if not file_path.endswith(".gz"):
                        continue
                    with gzip.open(file_path, 'rt', encoding='utf8',
                                   newline='') as fp:
                        logger.debug("Processing file: {}".format(file_path))
                        tsv = csv.reader(fp, delimiter='\t')
                        line_n = 0
                        for free_text, grounding_id in tsv:
                            line_n += 1
                            # For debugging -- En-dashes should be replaced
                            # with
                            # hyphens
                            if "\u2013" in free_text:
                                logger.debug("En-dash on {}:{} ({})."
                                             "".format(file_path,
                                                       line_n,
                                                       free_text))

                            # Add the appropriate prefix
                            grounding_id = \
                                "{}:{}".format(grounding_prefixes[file],
                                               grounding_id)

                            # Make sure the grounding ID exists
                            grounding_get = \
                                self._get_one_or_create(Grounding,
                                                        id=grounding_id)
                            grounding = grounding_get[0]

                            # Then make sure the free text of the mention is
                            # mapped to that ID (or skip it, if there is a
                            # conflict and `overwrite` is off)
                            done = False
                            while not done:
                                try:
                                    self._get_one_or_create(
                                        GroundingText,
                                        free_text=free_text,
                                        grounding=grounding)
                                    done = True
                                except app.exceptions.CustomError as e:
                                    if e.message == "DBCreateFailed":
                                        # Probably a unique key violation.
                                        # Should we overwrite the existing
                                        # entry?
                                        if overwrite:
                                            # Delete the existing free_text
                                            # mention, and overwrite it on
                                            # the next iteration
                                            old = \
                                                self.get_grounding_text_by_text(
                                                    free_text
                                                )
                                            logger.debug(
                                                "Overwriting existing "
                                                "grounding ID for {}. Was "
                                                "'{}', changing to '{}'."
                                                "".format(free_text,
                                                          old.grounding.id,
                                                          grounding_id)
                                            )
                                            self.session.delete(old)
                                            self.session.commit()
                                        else:
                                            # Skip it
                                            done = True
                                    else:
                                        # Some other message?
                                        logger.error(repr(e))
                                        done = True

                                except Exception as e:
                                    # Some other error -- Log it and let the
                                    # user deal with it
                                    logger.error(repr(e))
                                    done = True

                            # Done
                            self.session.commit()

    def _delete_unreferenced_grounding_texts(self):
        """
        Remove GroundingTexts that are not referenced by any Contexts
        Note: Not very useful -- It wipes the pre-set free text -> Grounding ID
        mappings without doing much else
        """
        import timeit
        start_time = timeit.default_timer()

        for grounding_text in list(self.session.query(GroundingText)):
            if bool(grounding_text.contexts):
                # This GroundingText has references
                continue

            # And if we're still here, this one doesn't
            logger.debug("Removing unreferenced GroundingText: {}"
                         "".format(grounding_text.free_text))
            self.session.delete(grounding_text)

        self.session.commit()

        logger.debug("Done in {:.03f}s."
                     "".format(timeit.default_timer() - start_time))
        logger.debug("Done removing unreferenced GroundingTexts. Remember to "
                     "re-run _load_grounding_dictionaries() to restore the "
                     "preset entries.")

    def _delete_unreferenced_groundings(self):
        """
        Remove Groundings that are not referenced by any GroundingTexts/Events
        """
        import timeit
        start_time = timeit.default_timer()

        for grounding in list(self.session.query(Grounding)):
            if bool(grounding.grounding_texts) or bool(grounding.events):
                # This Grounding has references
                continue

            # If we're still here, this one doesn't.
            logger.debug("Removing unreferenced Grounding: {}"
                         "".format(grounding.id))
            self.session.delete(grounding)

        self.session.commit()

        logger.debug("Done in {:.03f}s."
                     "".format(timeit.default_timer() - start_time))

    def _change_grounding_id(self, old_grounding_id, new_grounding_id):
        """
        Changes all references to `old_grounding_id` to reference
        `new_grounding_id` instead.  Useful for tying manually added
        contexts to existing grounding IDs, for example.
        """
        # Set the application name for the audit log
        with self._app_name("_change_grounding_id"):

            # Check whether the old grounding ID is even in use
            try:
                old_grounding = self.get_grounding_by_id(old_grounding_id)
            except sqlalchemy.orm.exc.NoResultFound:
                logger.error("The specified Grounding is not in use.")
                return

            # Make sure the new grounding ID is valid
            new_grounding_get = self._get_one_or_create(Grounding,
                                                        id=new_grounding_id)
            if not new_grounding_get[1]:
                logger.debug("Created grounding ID by user request: {}"
                             "".format(new_grounding_id))
            new_grounding = new_grounding_get[0]

            # Transfer GroundingTexts
            for grounding_text in list(old_grounding.grounding_texts):
                logger.debug("Changing grounding ID for text: {}"
                             "".format(grounding_text.free_text))
                grounding_text.grounding = new_grounding

            # Transfer Events
            logger.debug("Changing events for groundings: {} -> {}"
                         "".format(old_grounding.id,
                                   new_grounding.id))
            for event in list(old_grounding.events):
                event.groundings.remove(old_grounding)
                event.groundings.add(new_grounding)

            # Make sure we're done
            assert (len(old_grounding.grounding_texts) == 0)
            assert (len(old_grounding.events) == 0)

            self.session.commit()

    @staticmethod
    def _fix_encoding(string):
        """
        Given some UTF-8 string, replace common characters that cannot be
        mapped easily to ASCII
        """
        # En-dash
        # string = string.replace("\u2013", "-")
        return string
