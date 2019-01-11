# ==============
# System Options
# ==============

# Debug mode
debug_mode = True
immediate_console = False

# ------------------------
# Providers and Interfaces
# ------------------------
# The main script will parse these to allow the user to override them when
# starting the system.
# The system will attempt to use the defaults specified ('default_source' for
# providers, 'default_port' for interfaces) if the user does not pass any
# options to the main script; set these default options to None to disable
# them.

# Data providers:
# These modules manage a connection to the database that the corpus is stored
# in.  Only one should be active at any given time.
# Classes should be accessible as 'app.providers.<class>'
provider_classes = {
    # 'sqlite': {
    #     'class': 'SQLiteProvider',
    #     'default_source': 'data/context_annotations.db',
    #     'option_help': 'The path to the SQLite database file to use.'
    # }

    'postgres': {
        'class':          'PostgresProvider',
        'default_source': 'context@127.0.0.1:5432/context',
        'option_help':    'The address of the PostgreSQL server to connect '
                          'to. '
                          '(Format: "user:password@host:port/dbname")'
    }
}

# Client-server Interfaces:
# These modules manage client connections to the system.  Multiple interfaces
# can be active at the same time.
# Classes should be accessible as 'app.interfaces.<class>'
interface_classes = {
    'ws': {
        'class':        'WebsocketServer',
        'default_port': 8085,
        'option_help':  'The port to run the Websocket server on.'
    }

    # 'telnet': {
    #     'class': 'TelnetServer',
    #     'default_port': 8086,
    #     'option_help': 'The port to run the telnet server on.'
    # }
}

# ====================
# Annotations Database
# ====================
# Name of the base tables in the annotations database.
# These may be changed if necessary (e.g., for testing/development)
db_vars = {}

db_vars["paper_table"] = "paper"  # Paper metadata
db_vars["sentence_table"] = "sentence"  # Paper texts
db_vars["context_table"] = "context"  # Individual context mentions
db_vars["event_table"] = "event"  # Individual event mentions
db_vars["grounding_table"] = "grounding"  # Grounding IDS (one-many: context)
db_vars["comment_table"] = "comment"  # Per-paper annotator comments

# In the ORM schemata, Contexts will get a GroundingText, which maps a
# free-text mention to a Grounding ID.
# Events, on the other hand, will be associated directly with a Grounding,
# with no reference to the free-text.

# Associates free-text context mentions with their grounding IDs
db_vars["grounding_text_table"] = "grounding_text"

# Event-Grounding associations will be tracked individually (many-many)
db_vars["association_table"] = "event_grounding"

# Login role name for the PostgreSQL connection
db_vars["postgres_login"] = "context"

# Schema name for PostgreSQL tables - Should probably be the same as the
# login role name
db_vars["postgres_schema"] = "context"

# Will be passed to PostgreSQL's to_char function when rendering timestamps
db_vars["timestamp_format"] = "YYYY/MM/DD HH24:MI:SS [GMTOF]"

# =============
# Baseline Data
# =============
grounding_dictionaries_path = "data/dictionaries"
grounding_dictionary_prefixes = "data/dictionaries/prefixes.tsv"

# The sub-folders in this directory should be named after paper IDs,
# and should contain all the Reach output txt files and a matching curated
# TSV file
papers_path = "data/papers"
# If the sub-folder's name ends in the following suffix, it will be ignored
# when loading paper data.
paper_disabled_suffix = "-disabled"

# In case the full list of grounding prefixes is different from the ones
# listed in the file specified by `grounding_dictionary_prefixes`
paper_grounding_prefixes = (r"uaz|go|taxonomy|tissuelist|uniprot|cellosaurus"
                            r"|uberon")
# Associating prefixes with their textual descriptions
# (Will be displayed in order by the client)
context_categories = [
    ("Species", ["taxonomy"]),
    ("Organ", ["uaz:UBERON"]),
    ("Tissue", ["tissuelist"]),
    ("Cell Type", ["uaz:CL"]),
    ("Cellular Component", ["go"]),
    ("Cell Line", ["atcc", "cellosaurus"])
]

# Delimiter for 'mention_intervals.txt' in the Reach output: Used to be "-",
# but seems to have been changed to "%"
mention_intervals_delimiter = "%"

# =================
# Client Privileges
# =================
# If False, the matching command will be rejected if sent by a client.
client_commands = {
    "resize_event": True,
    "toy_load":     False
}
if not debug_mode:
    client_commands["debug"] = False
