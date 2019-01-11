"""
Template for the client-server interface API

ServerInterfaces handle the low-level connections.

Each incoming client is wrapped in a ClientInterface that is registered to the
controller.  The controller will pull input from the interface/push output to it
asynchronously.

Coroutines should be properly decorated with @asyncio.coroutine.
"""

import app.logger

logger = app.logger.getLogger(__name__)


# Decorator
def warn_undefined(func):
    """
    Lets the user know that some interface failed to define one of the core
    API functions
    """

    def wrapped(self, *args, **kwargs):
        logger.warning("Interface [{0}] did not define API method: {1}"
                       .format(self.__class__.__name__,
                               func.__name__))
        return func(self, *args, **kwargs)

    return wrapped


class ServerInterface:
    def __init__(self, port, register_client, deregister_client):
        """
        Starts up an interface server on the given port.
        Incoming clients should be wrapped in a ClientInterface and registered
        with the main controller using register_client() (which the controller
        will provide.)
        Similarly, clients should be de-registered on close.
        """
        return

    @warn_undefined
    def shutdown(self):
        """
        A coroutine that gracefully destroys the server
        """
        return


class ClientInterface:
    @warn_undefined
    def close(self):
        """
        A coroutine that gracefully kicks the client
        """

    @warn_undefined
    def get_input_async(self):
        """
        A coroutine that returns the next message from the client
        The message must be a Dictionary that at least specifies a command for
        the controller.
        """
        # {
        #     'command': command,
        #     'other_params': other_params
        # }
        return

    @warn_undefined
    def put_output_async(self, msg):
        """
        A coroutine that sends the specified message to the client
        The message will be a Dictionary that echoes the client's command and
        sends the results as a sub-item
        """
        # {
        #     'command': command,
        #     'data': results
        # }
        return
