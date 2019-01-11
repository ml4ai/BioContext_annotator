"""
A client-server interface that uses websockets for communication
"""
import asyncio
from concurrent.futures import FIRST_COMPLETED, CancelledError
import socket
import websockets
from websockets.server import WebSocketServerProtocol

# Messages to the client will be JSON-ified, compressed, and base64 encoded
import base64
import json
import zlib

import app.logger

logger = app.logger.getLogger(__name__)

from app.interfaces.template import ServerInterface, ClientInterface


class WebsocketServer(ServerInterface):
    def __init__(self, port, register_client, deregister_client):
        """
        Starts up a websocket server on the given port
        """
        super().__init__(port, register_client, deregister_client)
        self.port = port
        self.register_client = register_client
        self.deregister_client = deregister_client

        # We're going to jury-rig a new class that inherits from
        # websockets.server.WebSocketServerProtocol so that we can save the
        # remote IP address of incoming connections.
        class CustomWebSocketServerProtocol(WebSocketServerProtocol):
            def __init__(self, *args, **kwargs):
                self.remote_ip = ""
                super().__init__(*args, **kwargs)

            def connection_made(self, transport):
                # The remote IP address will be available as websocket.remote_ip
                self.remote_ip = transport.get_extra_info('peername')[0]
                super().connection_made(transport)

        # This just sets the server options; the server itself is only
        # available after the self.server is actually run via the event loop
        self.server = websockets.serve(self._new_client_handler,
                                       host=None,
                                       port=port,
                                       klass=CustomWebSocketServerProtocol)

        # Small hack to try to get a usable local IP address
        # (Connecting to a UDP address doesn't send packets)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 1))  # Google public DNS server
        self.local_ip = s.getsockname()[0]

        self.client_list = []
        self.handler_list = []

        logger.info(
            "Websocket server starting on {}, port {}.".format(self.local_ip,
                                                               self.port)
        )
        self.server = asyncio.get_event_loop().run_until_complete(self.server)
        # === The server is now accepting connections, but will only respond
        # === when the event loop is running
        # === (The event loop is managed by the controller)

    @asyncio.coroutine
    def shutdown(self):
        """
        A coroutine that gracefully destroys the server
        """
        logger.info("Shutting down Websocket server...")
        if len(self.client_list) > 0:
            logger.info("Kicking connected Websocket clients...")
            for client in self.client_list:
                yield from client.close()

        # The handlers in handler_list only complete once their clients are
        # completely closed and deregistered.
        if len(self.handler_list) > 0:
            yield from asyncio.wait(self.handler_list)

        self.server.close()
        yield from self.server.wait_closed()
        logger.info("Websocket server shutdown complete.")

    @asyncio.coroutine
    def _new_client_handler(self, websocket, _):
        """
        Wraps the new client worker in a Task so that we can track it.
        `path` is passed as a second argument by the websockets module, but we
        don't use it here.
        """
        handler = asyncio.async(self._new_client_worker(websocket))
        self.handler_list.append(handler)
        yield from asyncio.wait_for(handler, None)

    @asyncio.coroutine
    def _new_client_worker(self, websocket):
        """
        Initialises and registers the new client with the controller.
        """
        client = WebsocketClient(websocket)
        self.client_list.append(client)
        self.register_client(client)
        yield from client.communicate_until_closed()
        self.deregister_client(client)
        self.client_list.remove(client)


class WebsocketClient(ClientInterface):
    def __init__(self, websocket):
        self.websocket = websocket

        self.input_queue = asyncio.Queue()
        self.output_queue = asyncio.Queue()

    @asyncio.coroutine
    def close(self):
        """
        A coroutine that gracefully kicks the client
        """
        # Closing the websocket from the server side causes the infinite
        # receiver loop to terminate naturally
        yield from self.websocket.close()

    @asyncio.coroutine
    def get_input_async(self):
        """
        A coroutine that returns the next message from the client
        """
        msg = yield from self.input_queue.get()
        return msg

    @asyncio.coroutine
    def put_output_async(self, msg):
        """
        A coroutine that sends the specified message to the client
        """
        yield from self.output_queue.put(msg)

    @asyncio.coroutine
    def communicate_until_closed(self):
        logger.info("[{}] New client.".format(self.websocket.remote_ip))

        # Bring up the communication coroutines and wait for them.
        # They all run infinite loops, so if any one of them completes, it
        # means the client is no longer active.
        communication_tasks = [asyncio.async(self._receive_to_queue()),
                               asyncio.async(self._send_from_queue())]
        done, pending = yield from asyncio.wait(communication_tasks,
                                                return_when=FIRST_COMPLETED)

        logger.info(
            "[{}] Cleaning up client...".format(self.websocket.remote_ip)
        )

        for task in done:
            e = task.exception()
            if isinstance(e, Exception) and not \
                    isinstance(e, websockets.exceptions.ConnectionClosed):
                # If any of our tasks threw an unexpected exception, re-raise
                # it instead of failing silently.
                raise e

        # Cancel any hangers-on (viz., _send_from_queue())
        for task in pending:
            task.cancel()
        yield from asyncio.wait(pending)

        logger.info("[{}] Cleanup complete.".format(self.websocket.remote_ip))

    @asyncio.coroutine
    def _receive_to_queue(self):
        try:
            while True:
                msg = yield from self.websocket.recv()
                if msg is None:
                    logger.info(
                        "[{}] Client connection closed.".format(
                            self.websocket.remote_ip)
                    )
                    break

                # Attempt to b64decode, decompress, and parse JSON
                try:
                    msg = base64.b64decode(msg)
                    msg = zlib.decompress(msg)
                    # msg is a byte string at this point
                    msg = msg.decode()
                    msg = json.loads(msg)
                except ValueError:
                    logger.error(
                        "[{}] Bad input from client. "
                        "(Could not parse JSON)".format(
                            self.websocket.remote_ip)
                    )
                    break

                yield from self.input_queue.put(msg)
                logger.info("[{}] [RECV] {}".format(
                    self.websocket.remote_ip,
                    msg)
                )
        except CancelledError:
            logger.debug(
                "[{}] CancelledError on receiver -- "
                "Should not be happening.".format(self.websocket.remote_ip)
            )

    @asyncio.coroutine
    def _send_from_queue(self):
        try:
            while True:
                msg = yield from self.output_queue.get()
                msg = json.dumps(msg)
                msg_preview = msg[0:80]
                msg = base64.b64encode(zlib.compress(msg.encode())).decode()

                if not self.websocket.open:
                    logger.error(
                        "[{}] Send error: Socket closed unexpectedly.".format(
                            self.websocket.remote_ip))
                    break
                yield from self.websocket.send(msg)
                logger.info("[{}] [SEND] {}...".format(
                    self.websocket.remote_ip,
                    msg_preview)
                )
        except CancelledError:
            logger.debug("[{}] Cancelling sender...".format(
                self.websocket.remote_ip))
