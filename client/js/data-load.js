(function (App) {
  // This file adds the loadData() method to the App namespace.
  // When called, it populates the data stores for the current paper, working off the paper data sent by the server
  // over the Websocket connection.

  App.loadData = function (serverData) {
    // All intervals are 0-indexed

    console.log(serverData);

    // === Data that pertains directly to the current paper
    var Paper = serverData.paper;

    // === Data that pertains to context mentions
    var Contexts = {};
    // Context objects have the following attributes:
    // id, free_text, grounding_id, type, paper_id, line_num, interval_start, interval_end
    Contexts.reach = serverData.contexts_reach;
    Contexts.manual = serverData.contexts_manual;

    Contexts.categories = serverData.context_categories;

    // === Data that pertains to event mentions
    var Events = {};
    Events.raw = serverData.events;
    // Events will be pre-processed by data-init

    // Transfer to namespace
    App.Paper = Paper;
    App.Contexts = Contexts;
    App.Events = Events;
  };
})(App);
