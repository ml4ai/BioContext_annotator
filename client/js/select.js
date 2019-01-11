(function (App) {
  // This file controls the paper selection interface (shown before a specific paper is chosen)
  var Select = {};

  // Will contain jQuery objects corresponding to important DOM elements
  Select.Elements = {};

  Select.initSelect = function () {
    // Load the selection dialog HTML
    $('#main-wrapper').html(createPaperSelectHTML());

    Select.Elements.$paperTable = $("#paper-table");
    Select.Elements.$welcomeText = $("#welcome-text");

    Select.Elements.$paperTable.append("\
      <thead>\
        <tr>\
          <th>Paper ID</th>\
          <th>Paper Title</th>\
          <th>Last Modified</th>\
          <th>Read-Only</th>\
          <th>Pass</th>\
        </tr>\
      </thead>\
      ");

    // Initialise the DataTable
    var dataTableDOM =
      "<'row'<'small-6 columns'f><'small-6 columns'>r>" +
      "t" +
      "<'row'<'small-12 columns'B>>";

    // Set a sane table height
    var oneEm = parseFloat($('body').css("font-size"));
    var heightTarget = Math.max(
      window.innerHeight - Select.Elements.$welcomeText.outerHeight() - 20 * oneEm,
      20 * oneEm
    );

    Select.Elements.dataTable = Select.Elements.$paperTable.DataTable({
      columns: [
        {name: "paper_id"},
        {name: "title"},
        {name: "last_mod"},
        {name: "locked"},
        {name: "annotation_pass"}
      ],

      order: [[3, "asc"], [0, "asc"]],

      keys: {
        className: "focus_dud"
      },
      select: {
        style: "single"
      },
      paging: false,
      scrollY: heightTarget,
      dom: dataTableDOM,
      buttons: [
        {
          text: 'Annotate',
          name: 'annotateButton',
          enabled: false,
          action: function (e, dt, button, config) {
            // Navigate to the hash set on the button
            // (The hash is set by selectHandler based on the currently selected item)
            // (The button is technically an <a>, but it does not automatically navigate on click)
            App.Nav.setHash(button.attr("href"));
          }
        },
        {
          text: 'Read-Only View',
          name: 'viewButton',
          enabled: false,
          action: function (e, dt, button, config) {
            App.Nav.setHash(button.attr("href"));
          }
        },
        {
          text: 'Print View',
          name: 'printButton',
          enabled: false,
          action: function (e, dt, button, config) {
            App.Nav.setHash(button.attr("href"));
          }
        },
        {
          text: 'Article PDF',
          name: 'pdfButton',
          enabled: false,
          action: function (e, dt, button, config) {
            window.open(button.attr("href"));
          }
        },
        {
          text: 'Activate 2nd Pass',
          name: 'passButton',
          enabled: false,
          className: 'float-right',
          action: function (e, dt, button, config) {
            // Show a confirmation dialog before doing the actual switch
            var paperID = button.data('paperID');
            secondPassModal(paperID, dt);
          }
        }
      ],

      serverSide: true,
      ajax: function (data, callback, settings) {
        // We will get live paper info directly from the server.
        // Set the server command, and add callbacks for when it replies.
        data.command = "get_paper_list";

        var serverResponse = App.Websocket.sendRequestAsync(data);
        $.when(serverResponse).done(function (msg) {
          callback(msg.data);
        });
      }
    });

    // Add the table event listeners
    Select.Elements.$paperTable.on('select.dt', selectHandler);
    Select.Elements.$paperTable.on('deselect.dt', deselectHandler);
    Select.Elements.$paperTable.on('draw.dt', redrawHandler);

    // And show the table, which was hidden to prevent a FOUC
    Select.Elements.$paperTable.show();
  };

  // Transfer to namespace
  App.Select = Select;

  // === Private functions ===
  function createPaperSelectHTML() {
    // Goes in #main-wrapper
    return "\
    <div id='main-container' class='row small-8 columns shadow'>\
      <div id='welcome-text' class='row'>\
        <div class='small-12 small-centered columns'>\
          <h2>Reach Context Annotation Tool</h2>\
          <p>To get started, select a paper from the list below and click the 'Annotate' button.</p>\
        </div>\
      </div>\
      <div class='row'>\
        <div id='table-container' class='small-12 small-centered column'>\
          <div class='callout'>\
            <table id='paper-table' class='display' cellspacing='0' width='100%'>\
            </table>\
          </div>\
        </div>\
      </div>\
    </div>\
    ";
  }

  function selectHandler(e, dt, type, indexes) {
    // Event handler for selections in the DataTable; will enable the relevant buttons
    var paperID = dt.row(indexes).data()[0];

    dt.button('viewButton:name').enable()
      .node().attr("href", App.Nav.getViewHash(paperID));
    dt.button('printButton:name').enable()
      .node().attr("href", App.Nav.getPrintHash(paperID));
    dt.button('pdfButton:name').enable()
      .node().attr("href", App.Nav.getPdfUrl(paperID));

    var isReadOnly = dt.row(indexes).data()[3] == "Y";
    dt.button('annotateButton:name').enable(!isReadOnly)
      .node().attr("href", App.Nav.getAnnotateHash(paperID));

    // Unlike the statements above, which simply enable buttons with the appropriate hrefs, we need to store the
    // paperID for a helper function when changing the annotation pass.
    var isPassOne = dt.row(indexes).data()[4] == "1";
    dt.button('passButton:name').enable(isPassOne)
      .node().data('paperID', paperID);
  }

  function deselectHandler(e, dt, type, indexes) {
    // Disable all buttons on deselect
    dt.buttons().disable()
  }

  function redrawHandler() {
    // Disable all the buttons, then
    // TODO: try to restore the user's selection, if we can.
    Select.Elements.dataTable.buttons().disable();
  }

  function secondPassModal(paperID, dt) {
    // Ask the user for confirmation before promoting a given paper to the second annotation pass
    if ($('#pass-modal').length < 1) {
      var modalHTML = "\
          <div id='pass-modal' class='reveal'\
               data-reveal\
               data-close-on-click='false'\
               data-close-on-escape='true'>\
            <h2>Activate Second Pass</h2>\
            <p>Would you like to activate the second annotation pass for " + paperID + "?</p>\
            <p>(This will cause the tool to display Reach-identified events, and cannot be undone.)</p>\
            <div class='row'><div class='small-12 small-centered columns'>\
              <div class='button-group expanded'>\
                <a class='button' id='pass-yes'>Yes</a>\
                <a class='button alert' id='pass-cancel'>Cancel</a>\
              </div>\
            </div></div>\
          </div>\
          ";

      $(modalHTML).appendTo($('body'));
      var $passModal = $('#pass-modal');
      $passModal.foundation().foundation('open');

      // Close/Cancel
      $('#pass-cancel').on('click.select', function () {
        $passModal.foundation('close');
      });
      $passModal.on('closed.zf.reveal', function () {
        $passModal.remove();
      });

      // Confirm 2nd pass
      $('#pass-yes').on('click.select', function () {
        // Sends a confirmed request to the server to activate the 2nd annotation pass for a paper
        var serverResponse = App.Websocket.sendRequestAsync({
          command: 'second_annotation_pass',
          paperID: paperID
        });
        $.when(serverResponse)
          .done(function (msg) {
            var paperID = msg.data.paper_id;
            App.View.createAlert("information", "Successfully activated second pass for " + paperID + ".");

            // Refresh the table (which could take some time) and select the paper we just activated
            dt.on('draw.select', function () {
              App.meh = dt.rows(function (idx, data, node) {
                return data[0] == paperID
              });
              dt.rows(function (idx, data, node) {
                return data[0] == paperID
              }).select();
              dt.off('draw.select');
            });
            dt.draw();

          });


        $passModal.foundation('close');
      });
    }
  }

})(App);