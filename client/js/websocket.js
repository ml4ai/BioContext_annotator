(function (App) {
  // Functions that control the app's websocket interface, in the App.Websocket namespace.
  var Websocket = {};

  // Initialise a custom jQuery timer queue for websocket connections on $('head')
  Websocket.timerQueue = $("head");
  // And an array of queued commands to send when (if) the server connection goes up
  Websocket.sendQueue = [];
  // Which is distinct from this list of requests that have been sent to the server and are awaiting a response
  // The request's index in this list is its reference ID for client-server communications
  Websocket.receiveQueue = [];


  Websocket.initSocket = function () {
    if (Websocket.isUp) {
      // Nothing to do here
      return;
    }

    // Connects to the specified WebSocket server and sets up messaging handlers.
    Websocket.socket = new WebSocket("ws://" + App.Config.Websocket.host + ":" + App.Config.Websocket.port);
    Websocket.socket.onmessage = processMessage;

    Websocket.socket.onclose = function () {
      if (Websocket.isUp) {
        // We were doing fine until the server closed the connection
        App.View.createAlert(
          "error",
          "The server unexpectedly closed the connection; attempting to reconnect."
        );
        // Wait 1 sec, then try to reconnect
        Websocket.timerQueue.delay(1000).queue(function (next) {
          Websocket.initSocket();
          next();
        });
      }
      Websocket.isUp = false;
    };

    Websocket.socket.onerror = function () {
      Websocket.isUp = false;

      showReconnectModal();

      App.View.createAlert(
        "error",
        "Could not establish connection to server;<br>" +
        "the server may be down."
      );
    };

    Websocket.socket.onopen = function () {
      Websocket.isUp = true;

      removeReconnectModal();

      App.View.createAlert(
        "success",
        "Connection to server established."
      );

      // Fire off any queued messages
      while (Websocket.sendQueue.length > 0) {
        var sendObj = Websocket.sendQueue.shift();
        _sendObject(sendObj);
      }

      // Log connection details
      console.log("Established connection: ws://" + App.Config.Websocket.host + ":" + App.Config.Websocket.port);
    };
  };

  Websocket.checkReconnectModal = function () {
    // Check if the reconnect modal is active
    return $('#ws-modal').length > 0;
  };

  Websocket.sendRequestAsync = function (requestObj) {
    // The requestObj is, minimally, {command: <server_command>}.
    // Additionally, requestObj.id is reserved.
    // Also, requestObj.localData will be preserved to the receiveQueue but will *not* be sent to the server.
    // Finally, a Deferred object will be created at requestObj.deferred and returned by the function;
    // It will be resolved with the server's response when it is received.

    var requestID = getRequestID();
    requestObj.id = requestID;
    requestObj.deferred = $.Deferred();
    Websocket.receiveQueue[requestID] = requestObj;
    // Make a copy of the requestObj without localData
    var sendObj = {};
    $.extend(sendObj, requestObj);
    sendObj.localData = undefined;
    sendObj.deferred = undefined;

    if (!Websocket.isUp) {
      // The Websocket connection is either dead, or waiting to come up.  In any case, queue the request we want to
      // send and it will go through when (if) the connection is established
      Websocket.sendQueue.push(sendObj);
    } else {
      // No problem, the connection should be up -- Send it off
      _sendObject(sendObj);
    }

    // If it is an admin command, resolve the deferred immediately
    if (requestObj.command == "restart" || requestObj.command == "shutdown") {
      requestObj.deferred.resolve();
    }

    return requestObj.deferred;
  };

  Websocket.getPendingRequestsDeferred = function () {
    // Run through the receiveQueue and collect pending requests, returning a Deferred object that will be resolved
    // when all of them are
    var pendingRequests = [];
    for (var i = 0; i < Websocket.receiveQueue.length; i++) {
      if (Websocket.receiveQueue[i] !== null) {
        pendingRequests.push(Websocket.receiveQueue[i].deferred);
      }
    }
    return $.when.apply($, pendingRequests);
  };

  // Transfer to namespace
  App.Websocket = Websocket;

  // === Private Functions ===
  function showReconnectModal() {
    // TODO: Include in the modal any pending requests to the server (i.e., the contents of Websocket.sendQueue and
    // TODO: Websocket.receiveQueue)
    if ($('#ws-modal').length < 1) {
      var modalHTML = "\
          <div id='ws-modal' class='reveal'\
               data-reveal\
               data-close-on-click='false'\
               data-close-on-escape='false'>\
            <h2>Connection Error</h2>\
            <p>An error has occurred with the app's connection to the server.</p>\
            <p>Please wait a few moments and click the button below to try to reconnect.</p>\
            <p>If this problem persists, please contact the Context team.</p>\
            <div class='button-group'>\
              <a class='button' id='ws-reconnect'>Reconnect to Server</a>\
            </div>\
          </div>\
          ";
      $(modalHTML).appendTo($('body'));
      $('#ws-modal').foundation().foundation('open');
      $('#ws-reconnect').on('click.websocket', function () {
        Websocket.initSocket();
      });
    }
  }

  function removeReconnectModal() {
    var $wsModal = $('#ws-modal');
    if ($wsModal.length > 0) {
      // We had a 'Reconnect' modal dialog up
      $wsModal.foundation('close');
      $wsModal.remove();
    }
  }

  function getRequestID() {
    // Loops through the receiveQueue and returns the first index that is ready to hold a new request. If we reach the
    // end of the queue, extend it.
    for (var i = 0; i < Websocket.receiveQueue.length; i++) {
      if (Websocket.receiveQueue[i] == null) {
        Websocket.receiveQueue[i] = "[RESERVED]";
        return i;
      }
    }
    Websocket.receiveQueue.push("[RESERVED]");
    return Websocket.receiveQueue.length - 1;
  }

  function processMessage(msg) {
    // Server messages are sent with zlib compression + base64 encoding.
    // http://stackoverflow.com/questions/4507316/zlib-decompression-client-side

    var binaryString = atob(msg.data);
    msg = JSON.parse(pako.inflate(binaryString, {to: 'string'}));
    // The structure of msg is:
    // {id: <requestID>, command: <server_command>, data: <command_results>}

    // Match the incoming request to its counterpart in the receiveQueue, and clear its spot
    var requestID = Number(msg.id);
    var sentRequest = Websocket.receiveQueue[requestID];
    Websocket.receiveQueue[requestID] = null;

    // Restore localData
    msg.localData = sentRequest.localData;

    // If the server returns an error, pop a generic notification, then reject the request's deferred object so that
    // any specific fail() callbacks can execute.
    if (msg.data.error === true) {
      App.View.createAlert(
        "error",
        msg.data.message
      );
      sentRequest.deferred.reject();
    } else {
      // Resolve the request's deferred object with the server's response.
      sentRequest.deferred.resolve(msg);
    }
  }

  function _sendObject(sendObj) {
    // Takes the given message object and zlib compress + base64 encode it before sending it to the server.
    var sendString = btoa(pako.deflate(JSON.stringify(sendObj), {to: 'string'}));
    Websocket.socket.send(sendString);
  }
})(App);
