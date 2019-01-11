(function (App) {
  // Controls the app's location hash-based navigation functionality
  // Hash-based navigation is a bit tricky, because the hashchange event fires every time the hash is changed, whether
  // programmatically or otherwise.
  // Functions exposed by App.Nav should therefore only set the hash, and leave the heavy lifting to processHash to
  // prevent infinite hash-setting loops
  var Nav = {};

  Nav.initNav = function () {
    // Catch every time the hash is changed, programmatically or otherwise
    $(window).on("hashchange.nav", function () {
      Nav.processHash();
    });

    Nav.processHash();
  };

  Nav.getHash = function () {
    // Returns the current location hash in the URL, including leading '#'.
    var navHash = '';
    var indexOfHash = location.href.indexOf("#");
    if (indexOfHash > -1) {
      navHash = location.href.substring(indexOfHash);
    }
    return navHash;
  };

  Nav.setHash = function (newHash) {
    // newHash should include the trailing '#'.
    location.hash = newHash;
  };

  Nav.processHash = function () {
    // Reads the current location hash and show the relevant part of the application interface
    // If the user specifies a paper ID in the nav hash, use that instead of going to the selection interface
    var navHash = App.Nav.getHash();

    // The user may have tried to specify a hash manually despite a Websocket connection failure
    // If the reconnect modal is up, don't do anything.
    if (App.Websocket.checkReconnectModal()) {
      return;
    }

    // If the connection is up, check to make sure that all outstanding Websocket requests have been carried out
    var pendingRequests = App.Websocket.getPendingRequestsDeferred();
    pendingRequests.done(function () {
      // Now that all the requests are done
      if (navHash == "" || navHash == "#") {
        // No hash specified
        _showSelect();
      } else {
        // Strip the leading '#'
        navHash = navHash.substr(1);

        // Should we open in read-only mode?
        var regex = new RegExp("(.+)" + App.Config.Nav.readOnlySuffix + "$").exec(navHash);
        if (regex) {
          // Yes.  Index 0 is full match, index 1 is paper ID
          _showPaper(regex[1], "view");
          return;
        }

        // What about print mode?
        regex = new RegExp("(.+)" + App.Config.Nav.printSuffix + "$").exec(navHash);
        if (regex) {
          // Yes.  Index 0 is full match, index 1 is paper ID
          _showPaper(regex[1], "print");
          return;
        }

        // We're still here -- Annotate mode it is
        _showPaper(navHash, "annotate");
      }
    });
  };

  Nav.getSelectHash = function () {
    // Reset the hash, show the selection interface
    return "#";
  };

  Nav.getAnnotateHash = function (paperID) {
    // Setting this location hash starts the annotator for the given paper
    return "#" + paperID;
  };

  Nav.getViewHash = function (paperID) {
    // Setting this location hash loads up the read-only view of the paper (instead of the annotator view)
    return "#" + paperID + App.Config.Nav.readOnlySuffix;
  };

  Nav.getPrintHash = function (paperID) {
    // And this hash goes to the print view
    return "#" + paperID + App.Config.Nav.printSuffix;
  };

  Nav.getPdfUrl = function (paperID) {
    // Unlike the other functions, this one returns a direct URL
    return "pdf/" + paperID + ".pdf";
  };

  Nav.showSelect = function () {
    Nav.setHash(Nav.getSelectHash());
  };

  // Transfer to namespace
  App.Nav = Nav;

  // === Private functions ===
  function _showSelect() {
    // Start by popping a spinner
    $('#main-wrapper').html("\
    <div class='la-ball-clip-rotate-pulse spinner'>\
      <div></div>\
      <div></div>\
    </div>\
    ");

    App.Select.initSelect();
  }

  function _showPaper(paperID, mode) {
    // Called by processHash -- Actually loads the paper.
    // Mode is either "annotate", "view" or "print"

    // Start by popping a spinner
    $('#main-wrapper').html("\
    <div class='la-ball-clip-rotate-pulse spinner'>\
      <div></div>\
      <div></div>\
    </div>\
    ");

    // We need to query the server for the paper data, and defer further processing until we receive it
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'get_paper_data',
      paperID: paperID
    });
    $.when(serverResponse).done(function (msg) {
      // Check whether the paper is locked here first before loading it up
      if (msg.data.paper.locked && mode == "annotate") {
        // Let the user know something is up
        App.View.createAlert(
          "information",
          "The selected paper is locked, and has been opened in read-only view.",
          3000
        );

        // Switch to read-only view
        return Nav.setHash(Nav.getViewHash(paperID));
      }

      // At this point, the server has given us what we need
      // Load and prep data stores
      App.loadData(msg.data);
      App.initData();

      // Now, figure out how we are to display the data
      // First, do we initialise the main text frame in print mode or display mode?
      if (mode == "print") {
        App.View.initView("print");
      } else {
        App.View.initView();

        // Initialise annotator, passing true if in annotate mode, and false if in view-only mode
        if (mode == "annotate") {
          App.Annotator.initAnnotator(true);
        } else if (mode == "view") {
          App.Annotator.initAnnotator(false);
        }
      }
    });
    $.when(serverResponse).fail(function () {
      // The server encountered an error trying to give us the requested paper data
      // Go back to the selection interface (by setting the hash)
      Nav.setHash("");
    });
  }
})(App);