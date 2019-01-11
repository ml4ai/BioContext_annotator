"""
Main system controller
Initialises the data provider(s) and client-server interface(s) requested and
manages the main system event loop.
"""

import asyncio
from concurrent.futures import FIRST_COMPLETED, CancelledError
import urllib.parse

import app.logger

logger = app.logger.getLogger(__name__)

# ====================
# Providers/Interfaces
# ====================
import app.config
import app.providers
import app.interfaces

# Parse from configuration file and prepare for instantiation
provider_classes = {}
for provider, details in app.config.provider_classes.items():
    provider_classes[provider] = getattr(app.providers, details['class'])

interface_classes = {}
for interface, details in app.config.interface_classes.items():
    interface_classes[interface] = getattr(app.interfaces, details['class'])

# ====================

import app.exceptions


def execute(**kwargs):
    """
    Initialises the controller and runs the main system loop until a shutdown
    is requested by a client.
    """
    actor = Act(**kwargs)

    # If requested, drop to a console before starting to listen for connections
    if app.config.immediate_console or kwargs['console']:
        actor.exec_debug(None)

    # And if the console was initiated via the command line flag,
    # exit immediately once we're done.
    if kwargs['console']:
        return

    loop = asyncio.get_event_loop()
    system_loop = loop.create_task(actor.run_controller())
    loop.run_forever()
    # === No processing occurs past this point until the loop stops ===

    # If the loop stopped, it's probably because someone requested a shutdown
    # or restart.  Clean up the controller and let the main script know what
    # happened.
    loop_exception = system_loop.exception()
    if loop_exception is not None:
        loop.run_until_complete(actor.shutdown())
        loop.close()
        raise loop_exception


# Decorator
def langid_function(func):
    """
    Wraps functions that use the langid module with a try..except block that
    catches NLTK LookupErrors, among other things.
    :param func:
    :return:
    """

    def wrapped(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except LookupError as e:
            return {
                'error': True,
                'message': "Server returned a LookupError:\n" + str(e).strip()
            }
        except app.exceptions.CustomError as e:
            return {
                'error': True,
                'message': str(e).strip()
            }
        except Exception as e:
            # Better to return something than fail silently
            return {
                'error': True,
                'message': "Server returned an error:\n" + repr(e).strip()
            }

    return wrapped


class Act:  # Hurr hurr
    # ---------------------------
    # Initialisation and Shutdown
    # ---------------------------
    def __init__(self, **kwargs):
        """
        **kwargs should specify exactly one provider class and at least one
        interface class.
        """
        logger.info("=== Controller Initialisation ===")

        # Bring up data providers and server interfaces
        self.provider = None
        self.servers = []
        for key, value in kwargs.items():
            if value is None:
                # The user did not specify this provider/interface as a server
                # parameter, and its default settings have been disabled.
                continue

            if key == "console":
                # The 'console' command line flag determines whether or not
                # we should immediately drop to a console.
                continue

            if key in provider_classes.keys():
                if self.provider is None:
                    self.provider = provider_classes[key](value)
                else:
                    raise app.exceptions.CustomError(
                        "More than one data provider specified."
                    )
            elif key in interface_classes.keys():
                # If the 'console' flag was set, no interfaces will be
                # initialised.
                if kwargs['console']:
                    continue

                # Interfaces also need to be passed our client de-/registration
                # functions
                server = interface_classes[key](value,
                                                self.register_client,
                                                self.deregister_client)
                self.servers.append(server)
            else:
                raise app.exceptions.CustomError(
                    "Invalid provider/interface: '{}'".format(key)
                )

        # Make sure they're up
        if self.provider is None:
            raise app.exceptions.CustomError(
                "No data provider specified."
            )
        if len(self.servers) == 0 and not kwargs['console']:
            raise app.exceptions.CustomError(
                "No interfaces specified."
            )

        # Client list - Servers will register their clients with us as they come
        self.clients = []
        # And when they do, this future will get resolved and recreated.
        self.clients_changed = asyncio.Future()
        # So that we can watch them for input
        # This is a list of tuples: (ClientInterface, Future)
        self.client_watch = []

    @asyncio.coroutine
    def shutdown(self):
        logger.info("Shutting down client watchers...")
        for x in self.client_watch:
            # The client watchers are coroutines
            x[1].cancel()
            yield from x[1]

        logger.info("Shutting down interfaces...")
        for server in self.servers:
            # The connection manager uses coroutines
            yield from server.shutdown()
        self.servers = []

        logger.info("Shutting down data provider...")
        self.provider.shutdown()
        self.provider = None

    # ----------
    # Event Loop
    # ----------
    @asyncio.coroutine
    def run_controller(self):
        # N.B.: If Act was instantiated from an interactive console,
        # note that KeyboardInterrupt will drop back to a prompt
        # but NOT fully cancel the current iteration of do_loop() --
        # Old watchers will remain active, which might cause repeated
        #  operations and other subtle bugs.
        try:
            while True:
                yield from self.iterate_controller()
        except (app.exceptions.RestartInterrupt,
                app.exceptions.ShutdownInterrupt):
            asyncio.get_event_loop().stop()
            raise

    @asyncio.coroutine
    def iterate_controller(self):
        """
        In each iteration of the loop, we:

          1) Watch all registered clients, grabbing the first bit(s) of input to
             come through.  If any new clients are registered, restart the
             loop to include them too.
          2) Process the input and send it back to the client

        The beauty of coroutines is that we are guaranteed synchronous
        operation until we `yield from`, which blocks until something does
        happen (which prevents our pseudo-infinite loop above from chewing up
        resources)
        """

        # Watch new clients, stop watching dropped clients.
        # self.client_watch is a list of tuples (ClientInterface, Future)
        # that will be updated to represent all watched clients for this
        # iteration of the loop.
        watched_clients = []
        watched_client_futures = []
        for x in self.client_watch:
            if x[0] not in self.clients:
                # Goodbye
                x[1].cancel()
                yield from x[1]
                continue
            watched_clients.append(x[0])
            watched_client_futures.append(x[1])

        unwatched_clients = [client for client in self.clients
                             if client not in watched_clients]
        for client in unwatched_clients:
            # Hello
            watched_clients.append(client)
            watched_client_futures.append(
                asyncio.async(self._watch_client(client))
            )

        self.client_watch = [(watched_clients[x], watched_client_futures[x])
                             for x in range(len(watched_clients))]

        # Add the watcher for new/lost clients
        # On completion, this future will return True.
        # self.clients_changed will also be in the list of done tasks.
        watched_client_futures.append(self.clients_changed)

        # Begin the watch
        shutdown_this_watch = False
        restart_this_watch = False
        logger.debug(
            "Watcher: Watch begun. {} registered client(s).".format(
                len(watched_clients)
            )
        )
        client_watcher = asyncio.wait(watched_client_futures,
                                      return_when=FIRST_COMPLETED)
        done, _ = yield from client_watcher

        # Now deal with the ones which completed.
        # We are NOT guaranteed to have only one completed task here,
        # and we are NOT guaranteed that pending futures will stay
        # incomplete before the watch ends.
        for task in done:
            if task == self.clients_changed:
                logger.debug(
                    "Watcher: Clients changed. "
                    "Now have {} client(s).".format(
                        len(self.clients)
                    )
                )
                self.clients_changed = asyncio.Future()
            else:
                client, request = task.result()
                logger.debug(
                    "Watcher: Received client request: {}".format(
                        str(request)
                    )
                )
                # Remove the watch here; a new future will be generated for
                # this client by the next iteration of the loop
                self.client_watch.remove((client, task))

                # If the client wanted a shutdown or restart, hold the request
                # until the end of the watch
                try:
                    return_message = self.exec_command(request)
                    yield from client.put_output_async(return_message)
                except app.exceptions.ShutdownInterrupt:
                    shutdown_this_watch = True
                except app.exceptions.RestartInterrupt:
                    restart_this_watch = True

        logger.debug(
            "Watcher: Watch ended."
        )

        if shutdown_this_watch:
            raise app.exceptions.ShutdownInterrupt
        elif restart_this_watch:
            raise app.exceptions.RestartInterrupt

    # ---------------------------
    # Client interface management
    # ---------------------------
    def register_client(self, client):
        self.clients.append(client)
        if not self.clients_changed.done():
            self.clients_changed.set_result(True)

    def deregister_client(self, client):
        self.clients.remove(client)
        if not self.clients_changed.done():
            self.clients_changed.set_result(True)

    @asyncio.coroutine
    def _watch_client(self, client):
        """
        Resolves the given future when the specified client provides some input.

        The future will contain a reference to the client as well, so we know
        exactly who gave us the input.
        (We wouldn't get this information if we were waiting only on each
        client's bare get_input_async())
        """
        try:
            message = yield from client.get_input_async()
            return client, message
        except CancelledError:
            logger.debug(
                "_watch_client cancelled: We either lost the client or are "
                "shutting down."
            )

    # ========
    # Commands
    # ========
    def exec_command(self, request):
        """
        Perform a requested command and return the results as an object
        suitable for the client's use
        """
        request_id = request['id']
        command = request['command']

        # If the client is allowed to request it
        if command in app.config.client_commands \
                and app.config.client_commands[command] is False:
            logger.warning("Client tried to request command '{}', but it is "
                           "disabled.".format(command))
            results = {
                "error": True,
                "message": "Command disabled: {}".format(command)
            }
        else:
            # Try delegating it to a helper function
            if hasattr(self, 'exec_' + command):
                command_fn = getattr(self, 'exec_' + command)
                results = command_fn(request)
            else:
                logger.warning("Invalid input from client.")
                results = {
                    "error": True,
                    "message": "Invalid input to server."
                }

        return {
            'id': request_id,
            'command': command,
            'data': results
        }

    def exec_get_paper_list(self, request):
        # This is for the paper selection interface's data -- Delegate it to
        # the provider so that it can handle the complex query filtering
        # required
        return self.provider.get_paper_list(request)

    def exec_get_paper_data(self, request):
        # This is for the per-paper view -- Delegate it to the provider to
        # format the necessary data nicely.
        return self.provider.get_paper_data(request)

    def exec_get_paper_diff(self, request):
        # This is for the diff against the base annotations.
        return self.provider.get_paper_diff(request)

    def exec_second_annotation_pass(self, request):
        # This is for activating the second annotation pass
        return self.provider.second_annotation_pass(request['paperID'])

    def exec_get_comments(self, request):
        # Called when the client wants the current comments for a given paper
        return self.provider.get_comments(request['paperID'])

    def exec_save_comments(self, request):
        # Called when the client wants to save (new) comments for a given paper
        return self.provider.save_comments(request['paperID'],
                                           request['comments'])

    def exec_new_event(self, request):
        # Called when the client wants to instantiate a new (manual) event
        return self.provider.create_event(request['paperID'],
                                          request['lineNum'],
                                          request['newStart'],
                                          request['newEnd'])

    def exec_delete_event(self, request):
        # Called when the client wants to delete a manual event
        return self.provider.delete_event(request['paperID'],
                                          request['serverID'])

    def exec_resize_event(self, request):
        # Called when the client wants to save a resized event.
        return self.provider.resize_event(request['serverID'],
                                          request['newStart'],
                                          request['newEnd'])

    def exec_false_positive(self,request):
        # When the client wants to toggle the FP status of a Reach event in
        # the 2nd pass
        return self.provider.false_positive(request['paperID'],
                                            request['serverID'])

    def exec_new_context(self, request):
        # Called when the client wants to instantiate a new (manual) context
        return self.provider.create_context(request['paperID'],
                                            request['lineNum'],
                                            request['newStart'],
                                            request['newEnd'],
                                            request['contextText'])

    def exec_delete_context(self, request):
        # Called when the client wants to delete a manual context
        return self.provider.delete_context(request['paperID'],
                                            request['serverID'])

    def exec_save_event_contexts(self, request):
        # Called when the client wants to save the context associations for a
        # given event.
        return self.provider.save_event_contexts(request['serverID'],
                                                 request['groundings'])

    ###################

    def exec_view(self, request):
        # Requested records with ID within specified range
        # Echoes target to the client (for asynchronous message handling)
        # TODO: This echo might not be necessary once the client starts using
        # promises.
        records = self.provider.fetch_records(request['start'], request['end'])
        if 'record' not in request.keys():
            request['record'] = request['start']
        return {
            'results': records,
            'record': request['record']
        }

    def exec_meta(self, _):
        total = self.provider.fetch_total()
        tags = self.provider.fetch_tags()

        return {
            'total': total,
            'tags': tags
        }

    def exec_update(self, request):
        return self.provider.update_record(request['rowid'],
                                           request['field'],
                                           request['value'])

    def exec_search(self, request):
        # Start by URL decoding
        params = urllib.parse.parse_qs(request['query'])
        query = params['s'][0]
        page = int(params['p'][0])
        limit = request['perpage']
        offset = (page - 1) * limit

        return self.provider.fetch_search_results(query, offset, limit)

    def exec_literal_query(self, request):
        limit = 0
        if "limit" in request.keys():
            limit = request["limit"]
        return self.provider.execute_literal(request['query'], limit=limit)

    def exec_drop(self, request):
        return self.provider.execute_drop(request['target'])

    def exec_recreate(self, request):
        return self.provider.execute_recreate(request['target'])

    def exec_motd(self, _):
        """
        Return the motd to an motd-capable interface.
        """
        with open(app.config.motd_file, 'r') as f:
            motd = f.read()
        return motd

    def exec_restart(self, _):
        """
        We're within Act's looping mechanism -- Raise the interrupt to drop out
        of the loop
        """
        raise app.exceptions.RestartInterrupt

    def exec_shutdown(self, _):
        """
        Same as restart, but we're shutting down now
        """
        raise app.exceptions.ShutdownInterrupt

    def exec_debug(self, _):
        """
        Starts an interactive console on the current Act object for debugging.
        Bug: Trying to execute the debugger twice in one session currently fails
        """
        import sys

        try:
            import readline
        except ImportError:
            # On Windows, probably
            print(
                "Could not load 'readline' module (probably on Win32): Tab "
                "completion will not work.")
        else:
            import rlcompleter

            if sys.platform.startswith('darwin') and 'libedit' in \
                    readline.__doc__:
                # OS X Fix: http://superuser.com/questions/297527/
                # cant-type-the-b-letter-in-python-shell-in-os-x
                readline.parse_and_bind("bind ^I rl_complete")
            else:
                # Linux
                readline.parse_and_bind("tab: complete")

        import code

        # An interactive mode check -- sys.ps1 will be set when `code` is
        # first imported, or if Python was started in interactive mode
        if not hasattr(sys, "ps1"):
            sys.ps1 = ">>> "

        namespace = dict(globals(), **locals())

        # Prepare the banner for the console
        cprt = 'Type "help", "copyright", "credits" or "license" ' \
               'for more information.'
        post = "Interactive debug mode - Send EOF " \
               "(Ctrl-D on Linux/OS X, Ctrl-Z on Windows) to end."
        banner = "Python {} on {}\n{}\n\n{}\n".format(sys.version, sys.platform,
                                                      cprt,
                                                      post
                                                      )
        code.interact(local=namespace, banner=banner)

        # And reset the interactive mode check
        if hasattr(sys, "ps1"):
            del sys.ps1

        return True

    # -----------------------
    # Debug commands (if any)
    # -----------------------
    def exec_test_connection(self, _):
        try:
            return {"text": "The Websocket connection is working."}
        except Exception as e:
            logger.error(repr(e))
            return {
                "error": True,
                "message": repr(e)
            }

    def exec_test(self, _):
        """
        Generic testing function
        """
        return True

    def exec_toy_load(self, _):
        """
        Get the data provider to load in our toy data
        """
        return self.provider.toy_load()
