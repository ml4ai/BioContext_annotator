(function (App) {
  // This file controls the main flow of the application.

  // Initialise websocket connection
  App.Websocket.initSocket();

  // Hand-off to the Nav controller to bring up the relevant app interfaces
  App.Nav.initNav();
  
})(App);