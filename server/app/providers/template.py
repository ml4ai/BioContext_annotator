"""
A template for the data provider API
"""

import app.logger

logger = app.logger.getLogger(__name__)


# Decorator
def warn_undefined(func):
    """
    Lets the user know that some data provider failed to define one of the core
    API functions
    """

    def wrapped(self, *args, **kwargs):
        logger.warning("Data provider [{0}] did not define API method: {1}"
                       .format(self.__class__.__name__,
                               func.__name__))
        return func(self, *args, **kwargs)

    return wrapped


class DataProvider:
    # Startup/Shutdown
    def __init__(self, address):
        """
        Given an identifier for the DB resource, prepare the data provider
        """
        pass

    @warn_undefined
    def shutdown(self):
        """
        Gracefully destroy the data provider
        """
        pass

    # Metadata
    @warn_undefined
    def fetch_total(self):
        """
        Return the total number of records in the corpus as an Int
        """
        return

    @warn_undefined
    def fetch_tags(self):
        """
        Return the tags used in the corpus as a List of Strings
        """
        return

    # Selection
    @warn_undefined
    def fetch_record(self, row_id):
        """
        Return one record from the corpus as a Dictionary of fields -> values
        """
        return

    @warn_undefined
    def fetch_records(self, first, last):
        """
        Return a List of records (as Dictionaries) that have IDs within the
        range specified, inclusive
        """
        return

    @warn_undefined
    def fetch_search_results(self, query, offset, limit):
        """
        Return:
        1) Total number of results
        2) List of records (as Dictionaries) that match the search string, with
        optional offset and limit within the search results
        3) The search string used, including any server-side modifications
        4) The time taken to fetch the search results
        5) The offset requested [TRANSITIONAL]
        """
        # {
        #     'total': count,
        #     'results': results,  (or the string 'error' if search failed)
        #     'query': return_query,
        #     'elapsed': elapsed,
        #     'offset': offset
        # }
        return

    # Modification
    @warn_undefined
    def update_record(self, row_id, field, value):
        """
        Updates a record in the corpus, and returns the new field -> value pair,
        including any server-side modifications
        """
        return

    # Literal SQL
    @warn_undefined
    def execute_orm_filter(self, where_conditions, table):
        """
        Executes a select on the specified table with a literal where clause.
        Uses the SQLAlchemy ORM, so results are dictionaries.
        """
        return

    @warn_undefined
    def execute_literal(self, query):
        """
        Executes a literal sql query on the DB.
        Bypasses the ORM, so results are tuples.
        """
        results = "[Template]"
        return results
