"""
A basic telnet client-server interface.
Implements a parser for saved state and more complex processing.

The parser manages its own internal input/output queue loops to handle
user commands that do not need data from the server.  The general flow is as
follows:

    [Client] -> TelnetClient.input_queue -> TelnetParser._read_client_input()
    -> TelnetParser.parsed_input -> TelnetClient.get_input_async()
    -> [Server]

    [Server] -> TelnetClient.put_output_async() -> TelnetParser.raw_output
    -> TelnetParser._read_server_output() -> TelnetClient.output_queue
    -> [Client]
"""

import asyncio
from concurrent.futures import CancelledError, FIRST_COMPLETED
import socket

import app.logger

logger = app.logger.getLogger(__name__)

from app.interfaces.template import ServerInterface, ClientInterface
from app.interfaces.telnet_parser import TelnetParser, TelnetExit


class TelnetServer(ServerInterface):
    def __init__(self, port, register_client, deregister_client):
        super().__init__(port, register_client, deregister_client)
        self.port = port
        self.register_client = register_client
        self.deregister_client = deregister_client

        self.server = asyncio.start_server(self._new_client_handler,
                                           host=None,
                                           port=port)

        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 1))  # Google public DNS server
        self.local_ip = s.getsockname()[0]

        self.handler_list = []
        self.client_list = []

        logger.info(
            "Telnet server starting on {}, port {}.".format(self.local_ip,
                                                            self.port)
        )
        self.server = asyncio.get_event_loop().run_until_complete(self.server)

    @asyncio.coroutine
    def shutdown(self):
        """
        A coroutine that gracefully destroys the server
        """
        logger.info("Shutting down telnet server...")
        if len(self.client_list) > 0:
            logger.info("Kicking connected telnet clients...")
            for client in self.client_list:
                yield from client.close()

        # The handlers in handler_list only complete once their clients are
        # completely closed and deregistered.
        if len(self.handler_list) > 0:
            yield from asyncio.wait(self.handler_list)

        self.server.close()
        yield from self.server.wait_closed()
        logger.info("Telnet server shutdown complete.")

    @asyncio.coroutine
    def _new_client_handler(self, reader, writer):
        handler = asyncio.ensure_future(self._new_client_worker(reader, writer))
        self.handler_list.append(handler)
        yield from asyncio.wait([handler])

    @asyncio.coroutine
    def _new_client_worker(self, reader, writer):
        client = TelnetClient(reader, writer)
        self.client_list.append(client)
        self.register_client(client)
        yield from client.communicate_until_closed()
        self.deregister_client(client)
        self.client_list.remove(client)


class TelnetClient(ClientInterface):
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.remote_ip = writer.get_extra_info('peername')[0]

        self.input_queue = asyncio.Queue()
        self.output_queue = asyncio.Queue()

        self.parser = TelnetParser(self.input_queue,
                                   self.output_queue,
                                   self.remote_ip)

        self.kill_switch = asyncio.Future()

    @asyncio.coroutine
    def close(self):
        self.kill_switch.set_result(True)

    @asyncio.coroutine
    def _close(self):
        """
        A coroutine that gracefully kicks the client
        """
        self.writer.close()

    @asyncio.coroutine
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
        msg = yield from self.parser.get_input_async()
        return msg

    @asyncio.coroutine
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
        yield from self.parser.put_output_async(msg)

    @asyncio.coroutine
    def communicate_until_closed(self):
        logger.info("[{}] New telnet client.".format(self.remote_ip))

        communication_tasks = [asyncio.ensure_future(self._receive_to_queue()),
                               asyncio.ensure_future(self.parser.run_parser()),
                               asyncio.ensure_future(self._send_from_queue()),
                               self.kill_switch]
        done, pending = yield from asyncio.wait(communication_tasks,
                                                return_when=FIRST_COMPLETED)

        logger.info(
            "[{}] Cleaning up client...".format(self.remote_ip)
        )

        got_exception = None
        for task in done:
            e = task.exception()
            if isinstance(e, TelnetExit):
                # No need to handle this here; the client will be closed anyway.
                pass
            elif isinstance(e, Exception):
                # If any of our tasks threw a different exception, re-raise it
                # instead of failing silently.
                got_exception = e

        # Make sure we cancel the tasks in order, so that last minute
        # messages can still get sent.
        for task in communication_tasks:
            if not task.done():
                task.cancel()
                # self.kill_switch is a simple Future; it doesn't need to
                # clean up.
                if task != self.kill_switch:
                    yield from task

        yield from self._close()

        logger.info("[{}] Cleanup complete.".format(self.remote_ip))

        if got_exception is not None:
            print(got_exception)
            raise got_exception

    @asyncio.coroutine
    def _receive_to_queue(self):
        try:
            while True:
                msg = yield from self.reader.readline()

                # "If the EOF was received and the internal buffer is empty,
                # return an empty bytes object."
                if msg == b'':
                    logger.info(
                        "[{}] Client connection closed.".format(
                            self.remote_ip)
                    )
                    break

                logger.info("[{}] [RECV] {}".format(
                    self.remote_ip,
                    msg)
                )
                yield from self.input_queue.put(msg)

        except CancelledError:
            logger.debug(
                "[{}] Cancelling receiver...".format(self.remote_ip)
            )

    @asyncio.coroutine
    def _send_from_queue(self):
        preview_length = 80

        # ======================================
        @asyncio.coroutine
        def execute(msg):
            msg_preview = (msg[0:preview_length]
                           .replace('\n', '\\n')
                           .replace('\r', '\\r')
                           )

            if len(msg) > preview_length:
                msg_preview += "..."

            self.writer.write(msg.encode())
            yield from self.writer.drain()
            logger.info("[{}] [SEND] {}".format(
                self.remote_ip,
                msg_preview)
            )

        # ======================================

        try:
            while True:
                msg = yield from self.output_queue.get()
                yield from execute(msg)

        except CancelledError:
            logger.debug("[{}] Cancelling sender...".format(
                self.remote_ip))

            # Goodbye, client
            yield from self.output_queue.put("Server closing connection -- "
                                             "Goodbye.")

            while self.output_queue.qsize() > 0:
                msg = self.output_queue.get_nowait()
                yield from execute(msg)
