# Context Annotation Web App
# June 2016

"""
Dependencies
============
* Python 3.5.1

* WebSockets (https://pypi.python.org/pypi/websockets)

* SQLAlchemy (https://pypi.python.org/pypi/SQLAlchemy/1.0.4)

NOTE: Any bundled dependencies (in the 'lib' folder) will take precedence over
versions elsewhere on the system.
"""

import argparse
import importlib
import logging
import os
import sys

# ===============
# Path management
# ===============
sys.path.insert(1, os.path.join(os.getcwd(), "lib"))

# ================
# Argument parsing
# ================
parser = argparse.ArgumentParser(
    description="Starts the backend system for the context annotation tool.",
    epilog="Default settings for data providers and client-server interfaces "
           "can be set in 'app/config.py'.")

# Read in the available providers and interfaces from the configuration file
# and add them as arguments.
import app.config

for provider, details in app.config.provider_classes.items():
    parser.add_argument('-{}'.format(provider),
                        default=details['default_source'],
                        help=details['option_help'])

for interface, details in app.config.interface_classes.items():
    parser.add_argument('-{}'.format(interface),
                        default=details['default_port'],
                        help=details['option_help'])

# Do we drop to a console immediately?
parser.add_argument('-c', '--console',
                    action='store_true')

kwargs = vars(parser.parse_args())

# ====
# Init
# ====
quit_flag = False
while not quit_flag:

    print("\n=== System starting up ===\n", flush=True)

    # Start up the loader, which tracks imports past this point and marks them
    # for reloading when the server is restarted.
    # The only thing that won't be reloaded is this file.
    loader = importlib.import_module('app.loader').Loader()

    exceptions = importlib.import_module('app.exceptions')
    try:
        loader.init(**kwargs)

    # If we see any exceptions, the controller is dead.
    except exceptions.RestartInterrupt:
        print("\n=== Restarting system ===\n", flush=True)
        loader.unload()
        del loader
        # And loop around to recreate `loader` and reload the system
    except exceptions.ShutdownInterrupt:
        print("\n=== System shut down ===\n", flush=True)
        quit_flag = True
    except Exception as e:
        print("\n<<< System Error >>>\n", flush=True)
        raise
    else:
        # The controller went down silently -- This shouldn't happen, but let's
        # log it and leave the system down (in case of infinite loops etc.)
        print("\n<<< Unexpected shutdown >>>\n", flush=True)
        quit_flag = True
    finally:
        # Reset the logger so that any final log messages (from unexpected
        # errors, etc.) use the basic handler
        root_logger = logging.getLogger()
        root_logger.handlers = []
        logging.basicConfig()
