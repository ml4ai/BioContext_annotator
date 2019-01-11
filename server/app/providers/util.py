"""
Common utility functions and classes for data providers
"""
# ==============================================
# SQLAlchemy ORM mappings for application tables
# ==============================================

import sqlalchemy
import sqlalchemy.orm
import sqlalchemy.sql.expression
import sqlalchemy.exc
import sqlalchemy.ext.declarative

import app.config

# We're using uppercase constants here to easily differentiate them from the
# lowercase column mappings declared below.
# (They are variables in case we want to use a different set of tables for
# testing etc.)
# POSTGRES_SCHEMA = app.config.db_vars["postgres_schema"]
PAPER_TABLE = app.config.db_vars["paper_table"]
SENTENCE_TABLE = app.config.db_vars["sentence_table"]
CONTEXT_TABLE = app.config.db_vars["context_table"]
EVENT_TABLE = app.config.db_vars["event_table"]
GROUNDING_TABLE = app.config.db_vars["grounding_table"]
GROUNDING_TEXT_TABLE = app.config.db_vars["grounding_text_table"]
COMMENT_TABLE = app.config.db_vars["comment_table"]
ASSOCIATION_TABLE = app.config.db_vars["association_table"]


class SQLAlchemyORM:
    Base = sqlalchemy.ext.declarative.declarative_base()

    class WithDictionary:
        """
        Adds a '.dictionary' property to the classes below (which would
        otherwise return SQLAlchemy ORM objects) so that we can easily JSON-ify
        results
        """
        # Will be overwritten by descendant classes
        __table__ = None

        @property
        def dictionary(self):
            data = dict()
            for col in self.__table__.columns:
                data[col.name] = getattr(self, col.name)
            return data

    class Paper(Base, WithDictionary):
        __tablename__ = PAPER_TABLE

        # This ID is a Text type, since we are using PMC IDs as primary keys
        # (for now)
        id = sqlalchemy.Column(sqlalchemy.Text, primary_key=True)
        title = sqlalchemy.Column(sqlalchemy.Text)
        sections = sqlalchemy.Column(sqlalchemy.Text)
        locked = sqlalchemy.Column(sqlalchemy.Boolean, default=False)
        annotation_pass = sqlalchemy.Column(sqlalchemy.Integer, default=1)
        last_modified = sqlalchemy.Column(sqlalchemy.DateTime)

    class Sentence(Base, WithDictionary):
        __tablename__ = SENTENCE_TABLE

        id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True)
        line_num = sqlalchemy.Column(sqlalchemy.Integer)
        sentence = sqlalchemy.Column(sqlalchemy.Text)

        paper_id = sqlalchemy.Column(sqlalchemy.Text,
                                     sqlalchemy.ForeignKey(PAPER_TABLE + '.id'))

    class Context(Base, WithDictionary):
        __tablename__ = CONTEXT_TABLE

        id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True)
        line_num = sqlalchemy.Column(sqlalchemy.Integer)
        interval_start = sqlalchemy.Column(sqlalchemy.Integer)
        interval_end = sqlalchemy.Column(sqlalchemy.Integer)
        # Detected by Reach or manually annotated?
        # (reach|manual)
        type = sqlalchemy.Column(sqlalchemy.Text)

        paper_id = sqlalchemy.Column(sqlalchemy.Text,
                                     sqlalchemy.ForeignKey(PAPER_TABLE + '.id'))
        free_text = sqlalchemy.Column(sqlalchemy.Text,
                                      sqlalchemy.ForeignKey(
                                          GROUNDING_TEXT_TABLE + '.free_text'))

        @property
        def dictionary(self):
            # Overwrite the default .dictionary property -- For contexts,
            # we want the associated grounding IDs too.
            data = dict()
            for col in self.__table__.columns:
                data[col.name] = getattr(self, col.name)

            data['grounding_id'] = self.grounding_text.grounding.id

            return data

    class Event(Base, WithDictionary):
        __tablename__ = EVENT_TABLE

        id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True)
        line_num = sqlalchemy.Column(sqlalchemy.Integer)
        interval_start = sqlalchemy.Column(sqlalchemy.Integer)
        interval_end = sqlalchemy.Column(sqlalchemy.Integer)
        # Detected by Reach or manually annotated?
        # (reach|manual)
        type = sqlalchemy.Column(sqlalchemy.Text)
        # Only for Reach events (in the 2nd annotation pass)
        false_positive = sqlalchemy.Column(sqlalchemy.Boolean, default=False)

        paper_id = sqlalchemy.Column(sqlalchemy.Text,
                                     sqlalchemy.ForeignKey(
                                         PAPER_TABLE + '.id'))

        @property
        def dictionary(self):
            # Overwrite the default .dictionary property -- For events,
            # we want the associated grounding IDs too.
            data = dict()
            for col in self.__table__.columns:
                data[col.name] = getattr(self, col.name)

            data['groundings'] = []
            groundings = self.groundings
            for grounding in groundings:
                data['groundings'].append(
                    grounding.dictionary['id'])
            return data

    class Grounding(Base, WithDictionary):
        __tablename__ = GROUNDING_TABLE

        # This ID is a Text type because we are using the (unique) free-text
        # mentions as the primary key
        id = sqlalchemy.Column(sqlalchemy.Text, primary_key=True)

    class GroundingText(Base, WithDictionary):
        __tablename__ = GROUNDING_TEXT_TABLE

        # This table will be indexed by (unique) free text mentions
        free_text = sqlalchemy.Column(sqlalchemy.Text, primary_key=True)

        grounding_id = sqlalchemy.Column(sqlalchemy.Text,
                                         sqlalchemy.ForeignKey(
                                             GROUNDING_TABLE + '.id'))

    class Comment(Base, WithDictionary):
        __tablename__ = COMMENT_TABLE

        id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True)
        comment = sqlalchemy.Column(sqlalchemy.Text)

        paper_id = sqlalchemy.Column(sqlalchemy.Text,
                                     sqlalchemy.ForeignKey(
                                         PAPER_TABLE + '.id'))

    # Set up SQLAlchemy back-references (Uses class and property names)
    Paper.sentences = sqlalchemy.orm.relationship("Sentence",
                                                  back_populates="paper",
                                                  collection_class=set)
    Sentence.paper = sqlalchemy.orm.relationship("Paper",
                                                 back_populates="sentences")

    Paper.contexts = sqlalchemy.orm.relationship("Context",
                                                 back_populates="paper",
                                                 collection_class=set)
    Context.paper = sqlalchemy.orm.relationship("Paper",
                                                back_populates="contexts")

    Context.grounding_text = sqlalchemy.orm.relationship("GroundingText",
                                                         back_populates="contexts")
    GroundingText.contexts = sqlalchemy.orm.relationship("Context",
                                                         back_populates="grounding_text",
                                                         collection_class=set)

    GroundingText.grounding = \
        sqlalchemy.orm.relationship("Grounding",
                                    back_populates="grounding_texts")
    Grounding.grounding_texts = \
        sqlalchemy.orm.relationship("GroundingText",
                                    back_populates="grounding")

    Paper.events = sqlalchemy.orm.relationship("Event",
                                               back_populates="paper",
                                               collection_class=set)
    Event.paper = sqlalchemy.orm.relationship("Paper",
                                              back_populates="events")

    Paper.comment = sqlalchemy.orm.relationship("Comment",
                                                back_populates="paper",
                                                uselist=False)
    Comment.paper = sqlalchemy.orm.relationship("Paper",
                                                back_populates="comment")

    # Association table for many-to-many individual event-grounding associations
    event_grounding = \
        sqlalchemy.Table(
            ASSOCIATION_TABLE, Base.metadata,
            sqlalchemy.Column('event_id',
                              sqlalchemy.ForeignKey(EVENT_TABLE + '.id'),
                              primary_key=True),
            sqlalchemy.Column('grounding_id',
                              sqlalchemy.ForeignKey(GROUNDING_TABLE + '.id'),
                              primary_key=True),
        )

    Event.groundings = sqlalchemy.orm.relationship("Grounding",
                                                   secondary=event_grounding,
                                                   back_populates="events",
                                                   collection_class=set)
    Grounding.events = sqlalchemy.orm.relationship("Event",
                                                   secondary=event_grounding,
                                                   back_populates="groundings",
                                                   collection_class=set)
