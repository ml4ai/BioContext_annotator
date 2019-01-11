# Context Annotation Web App
# Server logger configuration

import datetime
import logging
import sys

# === Top-level Config ===
import app.config

log_level = ""
if app.config.debug_mode:
    log_level = "debug"


def get_az_time(timestamp):
    """
    Returns a struct_time for the given time in Arizona (GMT-7)
    :param timestamp:
    :return:
    """
    tz = datetime.timezone(datetime.timedelta(hours=-7))
    return datetime.datetime.fromtimestamp(timestamp, tz=tz).timetuple()


def getLogger(name):
    return logging.getLogger(name)


# On import/reload, (re-)configure the root logger, which will propagate to
# subsequent logger calls
root_logger = logging.getLogger()
if log_level == "debug":
    root_logger.setLevel(logging.DEBUG)
else:
    root_logger.setLevel(logging.INFO)
root_logger.handlers = []

formatter = logging.Formatter(
    # "[%(asctime)s] [%(levelname)s:%(name)s] %(message)s"
    "[%(asctime)s] [%(levelname)s] %(message)s"
)
formatter.converter = get_az_time
formatter.datefmt = '%Y-%m-%d %H:%M:%S'


class AsciiStreamHandler(logging.StreamHandler):
    def emit(self, record):
        record.msg = record.msg.encode('ascii', 'xmlcharrefreplace').decode()
        super().emit(record)


# For Windows systems, the default command prompt does not like printing unicode
# characters.
if sys.platform.startswith("win32"):
    console_handler = AsciiStreamHandler()
else:
    console_handler = logging.StreamHandler()

console_handler.setFormatter(formatter)
root_logger.addHandler(console_handler)

# SQLAlchemy prints a lot of messages at the INFO level.
logging.getLogger('sqlalchemy').setLevel(logging.WARN)

# Websockets also prints a lot of messages (including the contents of every
# frame) at the DEBUG level.
logging.getLogger('websockets.protocol').setLevel(logging.INFO)
