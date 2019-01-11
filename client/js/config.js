(function (App) {
  // Configuration Options
  "use strict";

  App.Config = {};

  // =-=-=-=-=-=-=-=-=
  // Websocket Options
  // =-=-=-=-=-=-=-=-=
  App.Config.Websocket = {};
  App.Config.Websocket.host = location.hostname || "localhost";
  App.Config.Websocket.port = 8090;

  // =-=-=-=-=-=-=-=-=
  // Annotator Options
  // =-=-=-=-=-=-=-=-=
  // Enable/Disable Annotation Features
  App.Config.Annotator = {};
  App.Config.Annotator.newEvents = true;
  App.Config.Annotator.deleteManualEvents = true;
  App.Config.Annotator.resizeEvents = false;
  App.Config.Annotator.resizeManualEvents = true;
  App.Config.Annotator.resizeReachEvents = true;
  App.Config.Annotator.newContexts = true;
  App.Config.Annotator.deleteManualContexts = true;

  // =-=-=-=-=-=-=
  // View Options
  // =-=-=-=-=-=-=
  App.Config.View = {};
  // If this option is true: Event spans that are next to punctuation marks (e.g., commas, full stops, left/right
  // brackets etc.) will be expanded to include those punctuation marks.
  // The events database on the backend WILL be modified accordingly.
  App.Config.View.eventsIncludePunctuation = false;

  // If true, special handling will be applied when Reach and manual events overlap (2nd annotation pass):
  // Manual events will take priority, and the non-overlapping parts of the Reach events will be *shown* as new
  // events (but the actual Reach event boundaries will not be affected on the server.)
  App.Config.View.handleReachManualEventOverlaps = true;

  // If this option is true: When event spans overlap, only the one with the earlier starting index is shown.
  // If it is false: Event spans that overlap one another will be kept in the event store.
  // The events database on the backend is NOT modified.
  App.Config.View.hideOverlappingEvents = true;

  // If this option is true: Reach events will be shown in the annotator.
  // If it is false: All Reach events will be hidden.
  // The events database on the backend is NOT modified.
  App.Config.View.showReachEvents = true;

  // Punctuation
  App.Config.View.startPunctuation = [
    "("
  ];
  App.Config.View.endPunctuation = [
    ",",
    ".",
    ")",
    ";",
    ":"
  ];

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // Hash-based Navigation Options
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  App.Config.Nav = {};
  // When the URL ends with this suffix, the paper will be shown with annotation functions disabled
  App.Config.Nav.readOnlySuffix = "-read-only";
  // Similarly, for the print view
  App.Config.Nav.printSuffix = "-print";

})(App);

