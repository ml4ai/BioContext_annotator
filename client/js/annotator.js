(function (App) {
  // The functions in this file control user interaction with the tool.
  // They live in the App.Annotator namespace
  var Annotator = {};

  // Will contain jQuery objects corresponding to important DOM elements
  Annotator.Elements = {};

  // Tracks the event ID of the currently active event
  // Set by initAnnotator()
  Annotator.activeEvent = null;

  // If annotateMode is false, the main annotator handlers will not be attached.
  // Set by initAnnotator()
  Annotator.annotateMode = null;

  // Will be different if we are in read-only mode
  Annotator.commentButtonText = "Add/Edit Comments";
  Annotator.returnButtonText = "Done Annotating";

  Annotator.initAnnotator = function (annotateMode) {
    // Initialises all the annotator elements.

    Annotator.activeEvent = 0;
    Annotator.annotateMode = annotateMode;

    if (!Annotator.annotateMode) {
      Annotator.commentButtonText = "View Comments";
      Annotator.returnButtonText = "Done Viewing";
    }

    initSidebar();
    initHandlers();
  };

  Annotator.refreshContextList = function () {
    // Refreshes the list of potential contexts on the sidebar from the data stores

    // Sort the list of categorised contexts that we have based on the first free-text mention associated with each ID
    var groundingCopy = [].concat(App.Contexts.categorised_groundings);
    for (var i = groundingCopy.length - 1; i >= 0; i--) {
      // groundingCopy is a List of: (<desc>, [<prefix>, ...])
      groundingCopy[i][1].sort(function (a, b) {
        // The list is sorted alphabetically based on the first free-text mention associated with each grounding ID
        var textA = App.Contexts.grounding[a][0];
        var textB = App.Contexts.grounding[b][0];
        if (textA < textB) return -1;
        if (textA > textB) return 1;
        return 0;
      });
    }

    // Build up the actual HTML
    var contextListHTML = "";
    $.each(groundingCopy, function (index, category) {
      var description = category[0];
      contextListHTML += "\
        <div class='context-category-label'>\
          " + description + "\
        </div>\
      ";

      $.each(category[1], function (index, groundingID) {
        var groundingHTML = groundingID.replace(/:/g, "-");
        var groundingLabel = App.Contexts.grounding[groundingID].join(" / ");
        var disableCheckboxes = "";
        if (!Annotator.annotateMode) {
          disableCheckboxes = "disabled";
        }

        contextListHTML += "\
        <div class='context-checkbox-pair'>\
          <input id='check-" + groundingHTML + "' \
                 type='checkbox' \
                 data-context-grounding='" + groundingID + "' \
                 " + disableCheckboxes + ">\
            <label for='check-" + groundingHTML + "'>" + groundingLabel + "</label>\
        </div>";
      });
    });


    // Load to DOM
    Annotator.Elements.$sideStatusMain.html(contextListHTML);
  };

  Annotator.refreshActiveElements = function () {
    // Special case: We have no events
    // We could have started this way, or the user could have deleted the last event (if it was a manual one)
    if (App.Events.events.length == 0) {
      // Reset everything
      // Sidebar
      Annotator.Elements.$sideStatusEventActive.text(0);
      Annotator.Elements.$sideStatusEventTotal.text(0);
      Annotator.Elements.$prevButton.addClass('disabled');
      Annotator.Elements.$nextButton.addClass('disabled');

      // Contexts
      $('.context').removeClass('selected-context').addClass('deselected-context');
      Annotator.Elements.$sideStatusMain.find(":checkbox").prop('checked', false);

      if (App.Config.Annotator.resizeEvents && Annotator.annotateMode) {
        // [Event span resizing handles]
        $('.event-handle').remove();
      }
      return;
    }

    // Updates the view elements based on the currently active event
    var $activeEvent = $("#event-" + Annotator.activeEvent);

    // [Sidebar nav section]
    // Events are 1-indexed for more natural display, even though they are 0-indexed internally.
    var activeEventDisplay = Annotator.activeEvent + 1;
    Annotator.Elements.$sideStatusEventActive.text(activeEventDisplay);
    Annotator.Elements.$sideStatusEventTotal.text(App.Events.events.length);
    // Enable prev/next buttons
    Annotator.Elements.$prevButton.removeClass('disabled');
    Annotator.Elements.$nextButton.removeClass('disabled');
    if (Annotator.activeEvent == 0) {
      Annotator.Elements.$prevButton.addClass('disabled');
    }
    if (Annotator.activeEvent == App.Events.events.length - 1) {
      Annotator.Elements.$nextButton.addClass('disabled');
    }

    // [Active event]
    $('.event').removeClass('active-event');
    $activeEvent.addClass('active-event');
    // Is it deleteable?
    if (App.Config.Annotator.deleteManualEvents && Annotator.annotateMode) {
      if (App.Events.events[Annotator.activeEvent].type == "manual") {
        Annotator.Elements.$deleteEventButton.removeClass('disabled');
      } else {
        Annotator.Elements.$deleteEventButton.addClass('disabled');
      }
    }
    // Can it be marked as a false positive?
    if (parseInt(App.Paper.annotation_pass) == 2 && Annotator.annotateMode) {
      if (App.Events.events[Annotator.activeEvent].type == "reach") {
        Annotator.Elements.$markFpButton.removeClass("disabled");
      } else {
        Annotator.Elements.$markFpButton.addClass("disabled");
      }
    }

    // [Contexts]
    // Deselect everything
    $('.context').removeClass('selected-context').addClass('deselected-context');
    Annotator.Elements.$sideStatusMain.find(":checkbox").prop('checked', false);

    // For each selected context for the active event:
    $.each(App.Events.events[Annotator.activeEvent]['groundings'], function (index, groundingID) {
      var groundingHTML = groundingID.replace(/:/g, "-");
      var $contextSpans = $("." + groundingHTML + "-context-grounding");
      if ($contextSpans.length < 1) {
        console.log("Missing context spans for grounding ID: %s", groundingID);
      }
      $contextSpans.removeClass('deselected-context').addClass('selected-context');
      $("#check-" + groundingHTML).prop('checked', true);
    });

    if (App.Config.Annotator.resizeEvents && Annotator.annotateMode) {
      // [Event span resizing handles]
      // Insert (text-based) drag handles on both sides of the active event span, after removing any existing ones
      $('.event-handle').remove();

      // Insert handles only around the types of events we want
      if (
        (App.Events.events[Annotator.activeEvent].type == "manual" && !App.Config.Annotator.resizeManualEvents) ||
        (App.Events.events[Annotator.activeEvent].type == "reach" && !App.Config.Annotator.resizeReachEvents)
      ) {
        // Resizing disabled for this event type; we're done here
        return;
      }

      $('<span/>')
        .addClass('event-handle')
        .html("&nbsp;&#10096;&nbsp;")
        .attr('data-resize-edge', 'left')
        .insertBefore($activeEvent);

      $('<span/>')
        .addClass('event-handle')
        .html("&nbsp;&#10097;&nbsp;")
        .attr('data-resize-edge', 'right')
        .insertAfter($activeEvent);
    }
  };

  Annotator.submitAnnotations = function () {
    // This is where the final submission takes place.
    // Mock it up for now.
    var previous = $('#mockOutput');
    if (previous.length) {
      previous.remove();
    }
    var outputData = JSON.stringify(App.Events.events, null, 2);
    var outputPanel = $("<div>").addClass("row column shadow").css({
      'background-color': '#def0fc',
      'margin-top': 40,
      'border': '1px solid lightgrey',
      'font-size': '0.75rem'
    }).attr('id', 'mockOutput');
    outputPanel.html("<pre>" + outputData + "</pre>");

    $('body').append(outputPanel);
    $('html, body').clearQueue().animate({
      scrollTop: outputPanel.offset().top - 50
    }, 750);
  };

  // Transfer to namespace
  App.Annotator = Annotator;

  // === Private Functions ===
  function initSidebar() {
    // Pick up sidebar components loaded by App.View
    Annotator.Elements.$sidebarContainer = $("#side-status-container");
    Annotator.Elements.$sidebar = $('#side-status');

    // 1) Loads the initial HTML template for the sidebar
    Annotator.Elements.$sidebar.html(initSidebarHTML());

    // Cache more important DOM elements
    Annotator.Elements.$mainText = App.View.Elements.$mainText;
    Annotator.Elements.$sideStatusNav = $('#side-status-nav');
    Annotator.Elements.$sideStatusEventActive = $('#side-status-event-active');
    Annotator.Elements.$sideStatusEventTotal = $('#side-status-event-total');
    Annotator.Elements.$jumpButton = $('#jump-button');
    Annotator.Elements.$jumpID = $('#jump-id');
    Annotator.Elements.$prevButton = $('#prev-button');
    Annotator.Elements.$scrollButton = $('#scroll-button');
    Annotator.Elements.$nextButton = $('#next-button');

    if (App.Config.Annotator.newEvents && Annotator.annotateMode) {
      Annotator.Elements.$sideStatusEvents = $('#side-status-events');
      Annotator.Elements.$newEventButton = $('#new-event-button');
    }

    if (App.Config.Annotator.deleteManualEvents && Annotator.annotateMode) {
      Annotator.Elements.$deleteEventButton = $('#delete-event-button');
    }

    if (App.Config.Annotator.newContexts && Annotator.annotateMode) {
      Annotator.Elements.$sideStatusContexts = $('#side-status-contexts');
      Annotator.Elements.$newContextStartInterface = $('#new-context-start-interface');
      Annotator.Elements.$newContextStart = $('#new-context-start');
      Annotator.Elements.$newContextInterface = $('#new-context-interface');
      Annotator.Elements.$newContextText = $('#new-context-text');
      Annotator.Elements.$newContextCreate = $('#new-context-create');
      Annotator.Elements.$newContextCancel = $('#new-context-cancel');
    }

    if (parseInt(App.Paper.annotation_pass) == 2 && Annotator.annotateMode) {
      // False positive marking for Reach events
      Annotator.Elements.$sideStatusFp = $('#side-status-fp');
      Annotator.Elements.$markFpButton = $('#mark-fp-button');
    }

    Annotator.Elements.$sideStatusMain = $('#side-status-main');
    Annotator.Elements.$sideStatusSubmit = $('#side-status-submit');
    Annotator.Elements.$commentsButton = $('#comments-button');
    Annotator.Elements.$returnButton = $('#return-button');
    Annotator.Elements.$sideStatusHR = Annotator.Elements.$sidebar.find('hr').first();

    // 2) Refresh the list of contexts on the sidebar
    Annotator.refreshContextList();

    // 3) Resize the sidebar to fit the window
    resizeSidebar();

    // 4) Refresh the sticky sidebar position (to fix a Foundation bug)
    refreshSticky();

    // 5) Context list overflow shadow (to make overflows more obvious on OS X)
    contextOverflowShadow();

    // 7) Refresh active elements
    Annotator.refreshActiveElements();
  }

  function initSidebarHTML() {
    var sidebarHTML = "";

    // Nav section
    sidebarHTML += "\
      <div id='side-status-nav'>\
        <div class='row' data-equalizer>\
          <div class='small-6 columns'>\
            <div class='side-status-header' data-equalizer-watch>\
              Event ID: <span id='side-status-event-active' />\
               (of <span id='side-status-event-total' />)\
            </div>\
          </div>\
          <div class='small-6 columns'>\
          <div class='input-group' data-equalizer-watch>\
            <input class='input-group-field' type='text' id='jump-id' placeholder='Event ID...'>\
            <div class='input-group-button'>\
              <input type='submit' class='button' id='jump-button' value='Go'>\
            </div>\
          </div>\
          </div>\
        </div>\
        <div class='expanded button-group'>\
          <input type='submit' class='button' id='prev-button' value='Prev'>\
          <input type='submit' class='button' id='scroll-button' value='Scroll To'>\
          <input type='submit' class='button' id='next-button' value='Next'>\
        </div>\
      </div>\
      <hr>\
      ";

    // Flag to see if we even have event/context/fp sections
    var midSection = false;

    // Event management
    if (App.Config.Annotator.newEvents && Annotator.annotateMode) {
      midSection = true;
      sidebarHTML += "\
      <div id='side-status-events'>\
        <div class='button-group'>\
          <input type='submit' class='button' id='new-event-button' value='New Event from Selection'>\
          <input type='submit' class='button disabled' id='delete-event-button' value='Delete Event'>\
        </div>\
      </div>\
      ";
    }

    // Context management
    if (App.Config.Annotator.newContexts && Annotator.annotateMode) {
      midSection = true;
      sidebarHTML += "\
      <div id='side-status-contexts'>\
        <div class='row' id='new-context-start-interface'>\
          <div class='small-12 columns'>\
            <input type='submit' class='button float-left' id='new-context-start' value='New Context'>\
          </div>\
        </div>\
        <div class='row' id='new-context-interface' style='display:none;'>\
          <div class='small-6 columns' style='padding-right:0;'>\
            <input type='text' id='new-context-text' placeholder='Context text...'>\
          </div>\
          <div class='small-3 columns' style='padding: 0 1px;'>\
            <input type='submit' class='expanded button' id='new-context-create' value='Create'>\
          </div>\
          <div class='small-3 columns' style='padding-left:0;'>\
            <input type='submit' class='alert expanded button' id='new-context-cancel' value='Cancel'>\
          </div>\
        </div>\
      </div>\
      ";
    }

    // 2nd Annotation Pass FP marker
    if (parseInt(App.Paper.annotation_pass) == 2 && Annotator.annotateMode) {
      midSection = true;
      sidebarHTML += "\
      <div id='side-status-fp'>\
        <div class='button-group'>\
          <input type='submit' class='button disabled' id='mark-fp-button' value='Toggle Event False Positive Marking'>\
        </div>\
      </div>\
      ";
    }

    if (midSection) {
      sidebarHTML += "<hr>";
    }

    // Main area -- Context association list, comments box, etc.
    sidebarHTML += "<div id='side-status-main'>";
    sidebarHTML += "</div>";
    sidebarHTML += "<hr>";

    // Submit section
    sidebarHTML += "\
    <div id='side-status-submit'>\
      <div class='expanded button-group'>\
        <input type='submit' class='success button' id='comments-button' value='" + Annotator.commentButtonText + "'>\
        <input type='submit' class='button' id='return-button' value='" + Annotator.returnButtonText + "'>\
      </div>\
    </div>";

    return sidebarHTML;
  }

  function resizeSidebar() {
    // Tunes the height of the sidebar and its internal context section to the current window height
    var oneEm = parseFloat($("body").css("font-size"));

    // -- Whole sidebar --
    var statusHeight = window.innerHeight -
      Number(Annotator.Elements.$sidebarContainer.attr('data-margin-top')) * oneEm -
      3 * oneEm;
    Annotator.Elements.$sidebar.css('height', statusHeight);

    // -- Main section --
    var hrHeight = Annotator.Elements.$sideStatusHR.outerHeight(true);
    var statusContextsHeight = Annotator.Elements.$sidebar.height() -
      Annotator.Elements.$sideStatusNav.outerHeight() - hrHeight -
      Annotator.Elements.$sideStatusSubmit.outerHeight() - hrHeight;

    var midSection = false;

    if (App.Config.Annotator.newEvents && Annotator.annotateMode) {
      midSection = true;
      statusContextsHeight -= (Annotator.Elements.$sideStatusEvents.outerHeight(true));
    }

    if (App.Config.Annotator.newContexts && Annotator.annotateMode) {
      midSection = true;
      statusContextsHeight -= (Annotator.Elements.$sideStatusContexts.outerHeight(true));
    }

    if (parseInt(App.Paper.annotation_pass) == 2 && Annotator.annotateMode) {
      midSection = true;
      statusContextsHeight -= (Annotator.Elements.$sideStatusFp.outerHeight(true));
    }

    // If any of the midsection button groups are active, manually add 1em (the bottom margin for one section) to the
    // target height -- The overlap with the <hr> and its margins causes problems otherwise
    if (midSection) {
      statusContextsHeight -= hrHeight;
      statusContextsHeight += oneEm;
    }

    Annotator.Elements.$sideStatusMain.css('height', statusContextsHeight);
  }

  function refreshSticky() {
    // Some of the Foundation sticky listeners seem borked, probably because we loaded the sidebar dynamically.
    // We'll have to recalculate the sidebar position after every resize (scrolling is fine)
    // cf. https://github.com/zurb/foundation-sites/issues/7899
    Annotator.Elements.$sidebarContainer.foundation('_calc', true);
  }

  function contextOverflowShadow() {
    // Adds inner shadows on the context list div to make it more obvious when there is overflow
    // Also used as a scroll handler on the context list div

    var currentScroll = Annotator.Elements.$sideStatusMain.scrollTop();
    var topShadow = currentScroll > 0;

    var maxScroll = Annotator.Elements.$sideStatusMain[0].scrollHeight;
    var bottomShadow = maxScroll - currentScroll != Annotator.Elements.$sideStatusMain.height();

    if (!topShadow && !bottomShadow) {
      Annotator.Elements.$sideStatusMain
        .removeClass('both-inner-shadow')
        .removeClass('top-inner-shadow')
        .removeClass('bottom-inner-shadow');
    } else if (topShadow && bottomShadow) {
      Annotator.Elements.$sideStatusMain
        .addClass('both-inner-shadow')
        .removeClass('top-inner-shadow')
        .removeClass('bottom-inner-shadow');
    }
    else if (topShadow) {
      Annotator.Elements.$sideStatusMain
        .addClass('top-inner-shadow')
        .removeClass('both-inner-shadow')
        .removeClass('bottom-inner-shadow');
    } else {
      Annotator.Elements.$sideStatusMain
        .addClass('bottom-inner-shadow')
        .removeClass('both-inner-shadow')
        .removeClass('top-inner-shadow');
    }
  }

  function initHandlers() {
    // All handlers are in the .annotator namespace

    // [Resize sidebar + check for overflow shadows on window resize]
    $(window).on("resize.annotator",
      Foundation.util.throttle(
        function () {
          resizeSidebar();
          refreshSticky();
          contextOverflowShadow();
        }
        , 15));

    // [Navigation]
    Annotator.Elements.$jumpButton.on("click.annotator", function (evt) {
      evt.preventDefault();
      var target = $jumpID.val();
      if ($.isNumeric(target) && target > 0 && target <= App.Events.events.length) {
        Annotator.activeEvent = Number(target) - 1;
        Annotator.Elements.$scrollButton.click();
        Annotator.refreshActiveElements();
      }
    });
    Annotator.Elements.$prevButton.on("click.annotator", function (evt) {
      evt.preventDefault();
      if (!$(evt.target).hasClass('disabled')) {
        Annotator.activeEvent -= 1;
        Annotator.Elements.$scrollButton.click();
        Annotator.refreshActiveElements();
        Annotator.Elements.$prevButton.focus();
      }
    });
    Annotator.Elements.$scrollButton.on("click.annotator", function (evt) {
      var target = $("#event-" + Annotator.activeEvent);
      evt.preventDefault();
      $('html, body').clearQueue().animate({
        scrollTop: target.offset().top - $(window).innerHeight() / 2
      }, 750);
    });
    Annotator.Elements.$nextButton.on("click.annotator", function (evt) {
      evt.preventDefault();
      if (!$(evt.target).hasClass('disabled')) {
        Annotator.activeEvent += 1;
        Annotator.Elements.$scrollButton.click();
        Annotator.refreshActiveElements();
        Annotator.Elements.$nextButton.focus();
      }
    });

    // [Context list overflow shadows]
    Annotator.Elements.$sideStatusMain.on("scroll.annotator",
      Foundation.util.throttle(
        contextOverflowShadow
        , 15));


    // [Comments interface]
    Annotator.Elements.$commentsButton.on("click.annotator", function () {
      // We will cannibalise the contexts section to hold the comments box
      if (Annotator.Elements.$commentsButton.attr('data-comments-mode') == 'true') {
        Annotator.Elements.$commentsButton
          .attr('data-comments-mode', 'false')
          .val(Annotator.commentButtonText);

        // We're done editing the comments.  Bring the context list back up with all its bells and whistles
        Annotator.refreshContextList();
        Annotator.refreshActiveElements();
        contextOverflowShadow();
      } else {
        var serverResponse = App.Paper.getCommentsAsync();
        $.when(serverResponse).done(function (msg) {
          // Turn the main sidebar section into a comments box
          Annotator.Elements.$commentsButton
            .attr('data-comments-mode', 'true')
            .val('Close Comments');

          var disableComments = "";
          if (!Annotator.annotateMode) {
            disableComments = "disabled";
          }

          var sideStatusHTML = "\
            <div id='side-status-comments'>\
              <div id='comments-instructions'>\
                When referring to any specific event or context mention in these comments, please also include the \
                line number that it occurs on.\
              </div>\
              <textarea id='comments-textarea' \
                        placeholder='Type your comments here.'\
                        " + disableComments + ">" + msg.data.comment.toString() + "\
              </textarea>\
            </div>";

          Annotator.Elements.$sideStatusMain.html(sideStatusHTML);

          var textareaHeight = Annotator.Elements.$sideStatusMain.height() -
            $('#comments-instructions').outerHeight(true);
          $('#comments-textarea').css('height', textareaHeight);

          contextOverflowShadow();
        });
      }
    });

    // [Done button]
    Annotator.Elements.$returnButton.on("click.annotator", function () {
      // Return to paper selection
      App.Nav.showSelect();
    });

    // [Delegated handler for event clicks in main paper area]
    Annotator.Elements.$mainText.on("click.annotator", ".event:not(.active-event)", function (evt) {
      evt.preventDefault();
      var $target = $(evt.target);
      if ($target.is('.context')) {
        // This is only true if the click event propagated up from the .context span.
        // I.e., we are in read-only mode. (In annotate mode, the handler on .context stops propagation)
        $target = $target.parents('.event');
      }
      Annotator.activeEvent = Number($target.attr('id').split("-")[1]);
      Annotator.refreshActiveElements();
    });

    // =-=-=-=-=-=-=-=-=-=-=-=-=
    // [Annotate Mode Handlers]
    // =-=-=-=-=-=-=-=-=-=-=-=-=
    if (!Annotator.annotateMode) return;

    // [Comment saving]
    Annotator.Elements.$sideStatusMain.on("input.annotator", "#comments-textarea", function (evt) {
      // Disable the close button
      Annotator.Elements.$commentsButton
        .addClass('disabled')
        .val("Saving...");
      // (Debounced) save request to server, with a callback that will re-enable the close button
      App.Paper.saveCommentsAsync(
        $('#comments-textarea').val(),
        function (msg) {
          Annotator.Elements.$commentsButton
            .removeClass('disabled')
            .val("Close Comments");
        }
      );
    });

    // [Delegated handler for context span clicks in main paper area]
    Annotator.Elements.$mainText.on("click.annotator", ".context", function (evt) {
      // Context clicks in main paper area
      evt.preventDefault();
      // If the clicked context was *within* another event's span, only toggle the context; don't allow the click to
      // propagate and activate the other event.
      evt.stopPropagation();
      var groundingID = $(evt.target).attr('data-context-grounding');
      App.Events.toggleContext(Annotator.activeEvent, groundingID);
      Annotator.refreshActiveElements();
    });

    // [Delegated handler for handling context checkbox clicks]
    Annotator.Elements.$sideStatusMain.on("change.annotator", ":checkbox", function (evt) {
      // Context clicks in sidebar checkbox area
      var groundingID = $(evt.target).attr('data-context-grounding');
      App.Events.toggleContext(Annotator.activeEvent, groundingID);
      Annotator.refreshActiveElements();
    });

    if (App.Config.Annotator.resizeEvents) {
      // [Delegated handlers for span editing handles]
      $(document).on("mousedown.annotator", ".event-handle", resizeEventHandler);
      $(document).on("mouseup.annotator", function () {
        $(document).off("mousemove.annotator");

        // Turn off 'hand' cursor
        $("html body").css('cursor', 'default');
      });
    }

    if (App.Config.Annotator.newEvents) {
      // [New event button]
      Annotator.Elements.$newEventButton.on("click.annotator", newEventHandler);
    }

    if (App.Config.Annotator.deleteManualEvents) {
      // [Delete button for manual events]
      Annotator.Elements.$deleteEventButton.on("click.annotator", deleteEventHandler);
    }

    if (App.Config.Annotator.newContexts) {
      // [New context button]
      Annotator.Elements.$newContextStart.on("click.annotator", newContextStartHandler);
      Annotator.Elements.$newContextCancel.on("click.annotator", newContextCancelHandler);
      Annotator.Elements.$newContextCreate.on("click.annotator", newContextCreateHandler);
    }

    if (App.Config.Annotator.deleteManualContexts) {
      // [Deletion events for manual contexts]
      Annotator.Elements.$mainText.on("mouseenter.annotator", ".manual-context-type", function (evt) {
        var $this = $(this);

        if ($this.find('#manual-context-delete').length > 0) {
          // The delete icon is already active. Cancel any leaveTimeout
          var leaveTimeout = Annotator.Elements.$mainText.data('leaveTimeout');
          clearTimeout(leaveTimeout);
        } else {
          // Create timeout to show the delete button
          var enterTimeout = setTimeout(function () {
            $("<span>")
              .attr('id', "manual-context-delete")
              .data('serverId', $this.attr('data-context-server-id'))
              .data('lineNum', $this.attr('data-line-num'))
              .html("&nbsp;&#x2716;&nbsp;")
              .appendTo($this)
              .hide()
              .show();
          }, 500);
          Annotator.Elements.$mainText.data('enterTimeout', enterTimeout);
        }
      });

      Annotator.Elements.$mainText.on("mouseleave.annotator", ".manual-context-type", function (evt) {
        var deleteIcon = $(this).find('#manual-context-delete');
        if (deleteIcon.length > 0) {
          // The delete icon is active. Create a leaveTimeout
          var leaveTimeout = setTimeout(function () {
            deleteIcon.remove();
          }, 500);
          Annotator.Elements.$mainText.data('leaveTimeout', leaveTimeout);
        } else {
          // The delete icon hasn't been shown yet. Clear the creation timeout.
          var enterTimeout = Annotator.Elements.$mainText.data('enterTimeout');
          clearTimeout(enterTimeout);
        }
      });

      Annotator.Elements.$mainText.on("click.annotator", "#manual-context-delete", function (evt) {
        evt.preventDefault();
        evt.stopPropagation();
        var serverID = $(this).data('serverId');
        var lineNum = $(this).data('lineNum');
        console.log("DEBUG: Deleting context: %s", serverID);
        App.Contexts.deleteContextAsync(serverID, function () {
          // Success callback
          App.Contexts.removeContextAndRefresh(serverID);
          App.View.refreshSentence(lineNum);
          Annotator.refreshContextList();
          Annotator.refreshActiveElements();
          contextOverflowShadow();
        });
      });
    }

    if (parseInt(App.Paper.annotation_pass) == 2) {
      // [False positive button for Reach events]
      Annotator.Elements.$markFpButton.on("click.annotator", falsePositiveHandler);
    }
  }

  function resizeEventHandler(evt) {
    // mousedown handler for event resize spans
    evt.preventDefault();

    var $this = $(this);
    var handleEdge = $this.attr('data-resize-edge');

    // Set 'hand' cursor for as long as mouse is held down
    $("html body").css('cursor', 'col-resize');

    // Add a mousemove handler across the whole document
    $(document).on("mousemove.annotator",
      Foundation.util.throttle(
        function (event) {
          // Find the active event
          var $activeEvent = $('#event-' + Annotator.activeEvent);
          var $eventSentence = $activeEvent.parents('.sentence');
          var lineNum = $eventSentence.attr('id').replace("sentence-", "");

          // Dissolve non-active event and context spans so that the cursor offsets are not thrown off.
          // (We have to do this before calling getRangeFromPosition to find the cursor)
          $eventSentence.find('.context, .event:not(.active-event)').each(function () {
            var $this = $(this);
            $this.replaceWith($this.text());
          });
          $eventSentence[0].normalize();

          // Now get the closest cursor position within the active sentence.
          var cursorRange = getRangeFromPosition(event.clientX, event.clientY);

          // Then pick out the next highest sentence span (class 'sentence') for the cursor and the active event
          var $cursorContainer = $(cursorRange.startContainer);
          var $cursorSentence = $cursorContainer.parents('.sentence');

          // If the cursor is in an unusual position, deal with it accordingly
          if ($cursorContainer.parents('.event-handle').length > 0) {
            // The user hasn't moved the mouse pointer far enough; the cursor is still in its original position and
            // picking the handle itself up as the target
            App.View.refreshSentence(lineNum);
            Annotator.refreshActiveElements();
            return;
          }
          if (!$cursorSentence.is($eventSentence)) {
            // Cursor is not within the same sentence as the active event.
            // TODO: Move the handle to the *nearest* part of the sentence (i.e., its start/end)
            App.View.refreshSentence(lineNum);
            Annotator.refreshActiveElements();
            return;
          }

          // Remove the event resizing handles so that the character we use as a handle doesn't show up in the sentence
          // text
          $('.event-handle').remove();
          $eventSentence[0].normalize();

          // -- The previousSibling of the active event Node should now be a textNode, if it exists.
          // -- Use its length as the base event offset
          var eventOffset = 0;
          var preTextNode = $activeEvent[0].previousSibling;
          if (preTextNode !== null) {
            eventOffset = preTextNode.textContent.length;
          }

          // The length of the event span's text
          var eventLength = $activeEvent.text().length;

          // The cursor offset depends on its position.
          // If: The cursor was within the event span. -> eventOffset needs to be added.
          //     The cursor was after the event span.  -> eventOffset and eventLength both need to be added.
          var cursorOffset = cursorRange.startOffset;
          if ($cursorContainer.parents('.active-event').length > 0) {
            cursorOffset += eventOffset;
          } else if ($cursorContainer.prevAll('.active-event').length > 0) {
            cursorOffset += eventOffset + eventLength;
          }

          // Snap to the nearest word boundary
          var rawSentence = App.Paper.sentences[lineNum];
          var prettySentence = $cursorSentence.text();
          var handleIndex = getClosestWordIndex(rawSentence, prettySentence, cursorOffset);

          // Then make sure that we don't cause any overlapping events
          // handleEdge comes from the parent closure
          fixOverlapsAndResizeEvent(handleEdge, handleIndex, lineNum);
        },
        15
      )
    );
  }

  function getRangeFromPosition(x, y) {
    // Picks up the closest text range to the coordinates given
    // Reference: http://jsfiddle.net/j1LLmr5b/26/
    var range;

    // Try the standards-based way first
    if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse();
    }
    // Next, the WebKit way
    else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    }

    return range;
  }

  function getClosestWordIndex(rawSentence, prettySentence, prettyOffset, onlyPrevious) {
    // Takes a character offset (relative to the *prettified* sentence), snaps it to the closest word boundary
    // (relative to the *actual* sentence), and returns the index of the word that *immediately follows*.
    //
    // If the calculated index is exactly at the end of the sentence, the function *will* return [the max index + 1],
    // which is, of course, invalid if used as is; the calling code should account for this accordingly.
    // E.g., if we are handling a right-edge resize handle, we would want to subtract one from the value returned to
    // get the end index for the span interval (since the span ends *before* the handle).  The left-edge handle, on the
    // other hand, should use the value returned without modification (since the span starts *after* the handle).

    // This function relies on prettifyHTMLText in view.js *only* deleting from, and never adding to, the original
    // sentence text.

    // If onlyPrevious is passed as a truth-y value, only the closest word boundary on the left will be returned, even
    // if the one on the right is closer.

    // To get the word index, we need to unprettify the sentence, since punctuation marks are considered to be
    // individual words as well.
    var workingSentence = prettySentence;
    var workingOffset = prettyOffset;
    // Loop over rawSentence, modifying workingSentence (and adjusting the offset) where they don't match.
    for (var idx = 0; idx < rawSentence.length; idx++) {
      if (rawSentence[idx] != workingSentence[idx]) {
        // There was a missing space (probably?)
        // In any case, add in whatever character was in the rawSentence and not the prettified one.
        workingSentence = workingSentence.substr(0, idx).concat(rawSentence[idx], workingSentence.substr(idx));
        if (workingOffset >= idx + 1) {
          // Because we are working with offsets, (cursorOffset - 1) is the *index* of the closest character in the
          // sentence.  Consequently, cursorOffset = charIndex + 1, so idx + 1 is the first offset to be affected by
          // changes to the sentence text.
          workingOffset += 1;
        }
      }
    }

    // Find the closest boundary to the cursor
    // As before, because it's an offset, (cursorOffset - 1) is the closest character index in sentenceText
    var boundaryOffset;
    if (workingOffset - 1 < 0) {
      // Cursor is exactly at start of sentence
      boundaryOffset = 0;
    }
    else if (workingOffset == workingSentence.length && !onlyPrevious) {
      // Cursor is exactly at end of sentence (length is 1 more than maximum index)
      // If onlyPrevious is set, we want the previous word boundary's offset, not the length of the entire sentence.
      boundaryOffset = workingSentence.length;
    } else {
      // Search for the closest boundary within the sentence
      var prevBoundary = workingOffset - 1, nextBoundary = workingOffset - 1;

      while (true) {
        if (workingSentence[prevBoundary] == " " || prevBoundary == 0) {
          boundaryOffset = prevBoundary;
          break;
        }
        prevBoundary -= 1;

        if ((workingSentence[nextBoundary] == " " || nextBoundary == workingSentence.length)
          && !onlyPrevious) {
          boundaryOffset = nextBoundary;
          break;
        }
        nextBoundary += 1;
      }
    }

    // The immediately following word index for the handle is the number of words in the sentence before it
    var prevWords = workingSentence.substr(0, boundaryOffset);
    var handleIndex;
    // "When the string is empty, split() returns an array containing one empty string, rather than an empty array."
    // When there are no previous words, .split().length is unreliable; catch it manually.
    if (prevWords == "") handleIndex = 0;  // No words before the handle.  Word index 0 is the next following word.
    else handleIndex = prevWords.split(" ").length;
    return handleIndex;
  }

  function fixOverlapsAndResizeEvent(handleEdge, handleIndex, lineNum) {
    // Makes sure that events don't overlap with existing ones after resizing.
    // (We don't want to let View's fixOverlaps handle it, because there is a possibility that the *other* event might
    // be the one that gets shifted if we do)

    // If this is a left handle, the span should start on the current word.
    // If this is a right handle, the span should *end* on the *previous* word.
    if (handleEdge == "right") handleIndex -= 1;

    // Now check for overlaps with other spans on the same line
    var lineEvents = App.Events.getByLine(lineNum);
    var activeEventObject = App.Events.events[Annotator.activeEvent];
    var activeEventStart = Number(activeEventObject.interval_start),
      activeEventEnd = Number(activeEventObject.interval_end);
    $.each(lineEvents, function (index, eventObject) {
      if (eventObject['eventID'] == Annotator.activeEvent) {
        return;
      }

      if (handleEdge == "left"
        && eventObject['intervalEnd'] < activeEventStart
        && handleIndex <= eventObject['intervalEnd']) {
        // User tried to move left handle past a previous event's right edge
        handleIndex = eventObject['intervalEnd'] + 1;
      } else if (handleEdge == "right"
        && eventObject['intervalStart'] > activeEventEnd
        && handleIndex >= eventObject['intervalStart']) {
        // User tried to move right handle past another event's left edge
        handleIndex = eventObject['intervalStart'] - 1;
      }
    });

    var lineContexts = App.Contexts.getByLine(lineNum);
    $.each(lineContexts, function (index, contextObject) {
      if (handleIndex >= contextObject['intervalStart'] && handleIndex < contextObject['intervalEnd']) {
        // The handle is splitting a multi-word context
        var distLeft = Math.abs(handleIndex - contextObject['intervalStart']);
        var distRight = Math.abs(handleIndex - contextObject['intervalEnd']);
        if (handleEdge == "left") {
          if (distRight <= distLeft) {
            // Snap left
            handleIndex = contextObject['intervalStart'];
          } else {
            handleIndex = contextObject['intervalEnd'] + 1;
          }
        } else if (handleEdge == "right") {
          if (distRight <= distLeft) {
            // Snap right
            handleIndex = contextObject['intervalEnd'];
          } else {
            handleIndex = contextObject['intervalStart'] - 1;
          }
        }
      }
    });

    // Sanity checks on span; don't allow it to be less than 1 word long
    if (handleEdge == "left" && handleIndex > activeEventEnd) {
      handleIndex = activeEventEnd;
    }
    if (handleEdge == "right" && handleIndex < activeEventStart) {
      handleIndex = activeEventStart;
    }

    // Finally, update annotatedEvents
    // TODO: What we *should* do here is notify the server, wait for the updated event object, refresh our local store,
    // TODO: and refresh the sentence
    if (handleEdge == "left") App.Events.resizeEvent(Annotator.activeEvent, handleIndex, activeEventEnd);
    if (handleEdge == "right") App.Events.resizeEvent(Annotator.activeEvent, activeEventStart, handleIndex);

    // Redraw the sentence
    App.View.refreshSentence(lineNum);
    Annotator.refreshActiveElements();
  }

  function newEventHandler(evt) {
    // Initialises a new event text span based on the user's current selection
    evt.preventDefault();

    var selectionRange = window.getSelection().getRangeAt(0);

    // NB: The 'anchor' of a Selection may come after the 'focus' of a Selection, but the start of a Range will always
    // precede the end of a Range.
    // https://developer.mozilla.org/en-US/docs/Web/API/Selection

    // For now: Don't attempt to make a best guess on the user's intentions -- If the selection is invalid, just pop a
    // warning.
    // TODO: Perhaps we could do something more intelligent here to guess what the user was actually aiming for (e.g.,
    // TODO: picking up the first non-overlapping part in the selection)
    var $startSentence = $(selectionRange.startContainer).parents('.sentence');
    var $endSentence = $(selectionRange.endContainer).parents('.sentence');

    if ($startSentence.length == 0 || $endSentence.length == 0 ||
      selectionRange.toString() == "" || selectionRange.toString() == " ") {
      App.View.createAlert(
        "information",
        "Please select text that is within a single sentence (excluding the sentence number)."
      );
      return;
    } else if (!$startSentence.is($endSentence)) {
      App.View.createAlert(
        "information",
        "Please select text that is within a single sentence. (Events may not span multiple sentences.)"
      );
      return;
    } else if ($(selectionRange.startContainer).parents('.event').length > 0 ||
      $(selectionRange.endContainer).parents('.event').length > 0
    ) {
      App.View.createAlert(
        "information",
        "Please ensure that the selection does not overlap any existing events.<br>" + ""
        // "Existing events can be resized first if necessary."
      );
      return;
    } else if ($(selectionRange.startContainer).parents('.context').length > 0 ||
      $(selectionRange.endContainer).parents('.context').length > 0
    ) {
      App.View.createAlert(
        "information",
        "Please ensure that the selection does not start or end in the middle of a context mention.<br>" + ""
        // "The newly created event can be resized later if necessary."
        // ^^^^ An unfortunate hack needed due to the way text selections are handled :(
      );
      return;
    }

    var lineNum = $startSentence.attr('id').replace("sentence-", "");

    // Remove all other spans, refresh raw offsets, go from there
    // This WILL get borked if the selection starts/ends in the middle of another span, because of the way the user
    // selection is modified when that span is dissolved (will probably select the whole sentence)
    $startSentence.find('.context, .event').each(function () {
      var $this = $(this);
      $this.replaceWith($this.text());
    });
    $startSentence.find('.event-handle').remove();
    $startSentence[0].normalize();
    selectionRange = window.getSelection().getRangeAt(0);

    // Snap the start and end of the selection to the nearest word boundaries, get the relevant indices
    var rawSentence = App.Paper.sentences[lineNum];
    var prettySentence = $startSentence.text();
    var selectionWords = selectionRange.toString().split(" ");
    var startWordIndex, endWordIndex;
    if (selectionWords.length == 1 ||
      (selectionWords.length == 2 && selectionWords[1] == "")) {
      // We are within a single word.  Make sure that we find the word boundary to the *left*, even if the right word
      // boundary is closer.
      startWordIndex = getClosestWordIndex(rawSentence, prettySentence, selectionRange.startOffset, true);
      endWordIndex = startWordIndex;
    } else {
      startWordIndex = getClosestWordIndex(rawSentence, prettySentence, selectionRange.startOffset);
      endWordIndex = getClosestWordIndex(rawSentence, prettySentence, selectionRange.endOffset);
    }

    // And -1 to the ending index, so that we end on the previous word -- *Unless* only one word was selected, in which
    // case startWordIndex and endWordIndex will be the same.
    if (endWordIndex != startWordIndex) endWordIndex -= 1;

    fixOverlapsAndCreateEvent(lineNum, startWordIndex, endWordIndex);

    // // Try to get a fix on the best start and end offsets for the Range
    // // The (raw) offsets will be within a single sentence, but may overlap with other events (for now, this will be
    // // fixed after we move the offsets to the closest words)
    // var lineNum, startOffset, endOffset;
    //
    // // - When calculating the offsets, keep track of the lineNum for both the start and end of the Range; reconcile
    // // them later if they don't match.  Invalid lineNums (i.e., where we cannot determine which sentence the
    // boundary
    // // is in) have a value of -1.
    // var startLineNum = -1, endLineNum = -1;
    // var $startContainer = $(selectionRange.startContainer);
    // var $endContainer = $(selectionRange.endContainer);
    // var $startSentence = $startContainer.parents('.sentence');
    // if ($startSentence.length == 0) {
    //   // The start anchor was not in a .sentence div.  Try to repair: If it is in a .sentence-number div, move the
    //   // anchor to the start of its associated sentence
    //   var $startSentenceNumber = $startContainer.parents('.sentence-number');
    //   if ($startSentenceNumber.length > 0) {
    //     startLineNum = $startSentenceNumber.attr('id').replace("sentence-number-", "");
    //     startOffset = 0;
    //   }
    // } else {
    //   startLineNum = $startSentence.attr('id').replace("sentence-","");
    // }
    // var $endSentence = $(selectionRange.endContainer).parents('sentence');
    // if ($endSentence.length == 0) {
    //   // Same thing for the end anchor, but move to the end of the previous sentence instead.
    //   var $endSentenceNumber = $endContainer.parents('.sentence-number');
    //   if ($endSentenceNumber.length > 0) {
    //     endLineNum = $startSentenceNumber.attr('id').replace("sentence-number-", "");
    //   }
    // }
    // //if ($startSentence.length == 0) {
    // //  App.View.createAlert('warning', "No paper text selected -- Event not created.");
    // //  return;
    // //}
    //
    // $startSentence.find('.context, .event:not(.active-event)').each(function () {
    //   var $this = $(this);
    //   $this.replaceWith($this.text());
    // });
    // $startSentence[0].normalize();
    // userSelection = window.getSelection();
    // selectionRange = userSelection.getRangeAt(0);
    //
    // console.log(selectionRange);
    //
    // // --------
    //
    // //App.View.createAlert('information', $(userSelection.anchorNode).text());
    // //App.View.createAlert('information', $(userSelection.focusNode).text());
    // App.View.createAlert('information', $(selectionRange.startContainer).text());
    // App.View.createAlert('information', $(selectionRange.endContainer).text());
    //
    // // When the selection overlaps another event span or crosses into a new sentence, create a new event that
    // stretches // as far as possible from the closest legal boundary.  If both boundaries are legal, use the -start-
    // of the range // as the relevant anchor.
  }

  function fixOverlapsAndCreateEvent(lineNum, startWordIndex, endWordIndex) {
    // TODO: Handle case where user's selection completely contains some other event span(s) -- Will not be picked up
    // TODO: by basic sanity checks, probably need the word indices to detect this.
    // TODO: We will also want to make sure that events don't overlap multi-word contexts halfway.

    var lineEvents = App.Events.getByLine(lineNum);
    var abortCreate = false;
    $.each(lineEvents, function (index, eventObject) {
      if (eventObject['intervalStart'] >= startWordIndex && eventObject['intervalEnd'] <= endWordIndex) {
        // Case where user selection includes at least one entire other event span
        App.View.createAlert(
          "information",
          "Please ensure that the selection does not overlap any existing events.<br>" +
          "Existing events can be resized first if necessary."
        );
        abortCreate = true;
      }
    });

    if (abortCreate) {
      return;
    }

    App.Events.newEventAsync(lineNum, startWordIndex, endWordIndex,
      function (msg) {
        // Success callback
        // Push the new event to the local event store, and activate it
        var newEvent = msg.data;
        Annotator.activeEvent = App.Events.pushLocalEventAndRefresh(newEvent);

        // At this point, some of the HTML spans might be off -- We want to refresh every sentence
        // containing an event
        $.each(App.Events.events, function (index, event) {
          App.View.refreshSentence(event.line_num);
        });
        Annotator.refreshActiveElements();
      });
  }

  function deleteEventHandler(evt) {
    // Deletes the active event
    evt.preventDefault();

    // Sanity checks
    // If the button is disabled, ignore clicks
    if (Annotator.Elements.$deleteEventButton.hasClass('disabled')) {
      return
    }
    // The event should be a manual one
    if (App.Events.events[Annotator.activeEvent].type != "manual") {
      console.log("[ERROR] Tried to delete a non-manual context");
      return
    }

    // Proceed
    var serverID = App.Events.events[Annotator.activeEvent].id;
    var lineNum = App.Events.events[Annotator.activeEvent].line_num;
    console.log("DEBUG: Deleting event: %s", serverID);
    App.Events.deleteEventAsync(serverID, function () {
      // Success callback -- Update the local event store and refresh the view
      App.Events.removeLocalEventAndRefresh(serverID);
      App.View.refreshSentence(lineNum);

      // At this point, some of the other HTML spans might also be off --
      // We want to refresh every sentence containing an event
      $.each(App.Events.events, function (index, event) {
        App.View.refreshSentence(event.line_num);
      });
      // Jump back to the previous event
      if (Annotator.activeEvent >= 1) {
        Annotator.activeEvent -= 1;
      }
      Annotator.refreshActiveElements();
    })
  }

  function newContextStartHandler(evt) {
    // Starts the process of creating a new context mention
    // Allows free-text entry, but initialises the textbox with the current selection
    evt.preventDefault();

    var selectedString = window.getSelection().toString();
    selectedString = $.trim(selectedString);
    Annotator.Elements.$newContextText.val(selectedString);

    Annotator.Elements.$newContextStartInterface.hide();
    Annotator.Elements.$newContextInterface.show();

  }

  function newContextCancelHandler(evt) {
    // Cancels the whole new context process
    evt.preventDefault();
    Annotator.Elements.$newContextText.val("");
    Annotator.Elements.$newContextInterface.hide();
    Annotator.Elements.$newContextStartInterface.show();
  }

  function newContextCreateHandler(evt) {
    // Actually creates the new context spans
    var contextText = Annotator.Elements.$newContextText.val();
    contextText = $.trim(contextText);
    // TODO: Trim punctuation
    if (contextText == "") {
      // Nothing/Whitespace entered
      App.View.createAlert(
        "information",
        "Please enter the text of the context mention you wish to create."
      );
      return;
    }

    // Start by searching through the paper to find instances of the new context string
    var potentialInstances = App.Contexts.findInstances(contextText);
    // -------
    //console.log(potentialInstances);
    //for (var i = 0; i < potentialInstances.length; i++) {
    //  var sentenceWords = App.Paper.sentences[potentialInstances[i].lineNum].split(" ");
    //  console.log(sentenceWords.slice(potentialInstances[i].intervalStart, potentialInstances[i].intervalEnd + 1));
    //}
    // -------

    // Then do some overlap processing and send the creation request
    fixOverlapsAndCreateContexts(potentialInstances, contextText);
  }

  function fixOverlapsAndCreateContexts(potentialInstances, contextText) {
    // Given a list of potential context instances, weeds out any overlapping contexts, fixes any overlapping events,
    // and sends the creation requests to the server
    for (var i = 0; i < potentialInstances.length; i++) {
      var potentialContext = potentialInstances[i];
      var abortCreate = false;
      var lineNum = potentialContext.lineNum;

      // Check for overlaps with other contexts on the same line
      var lineContexts = App.Contexts.getByLine(lineNum);
      $.each(lineContexts, function (index, context) {
        if (
          potentialContext.intervalStart >= context.intervalStart &&
          potentialContext.intervalStart <= context.intervalEnd
        ) {
          // Start of the potential context is in the middle of another one.
          abortCreate = true;
        }

        if (
          potentialContext.intervalEnd >= context.intervalStart &&
          potentialContext.intervalEnd <= context.intervalEnd
        ) {
          // End of the potential context is in the middle of another one.
          abortCreate = true;
        }
      });
      if (abortCreate) {
        continue;
      }

      // Check for overlaps with events on the same line
      var lineEvents = App.Events.getByLine(lineNum);
      $.each(lineEvents, function (index, event) {
        var eventLeft = event.intervalStart, eventRight = event.intervalEnd;
        var distLeft, distRight;
        if (
          eventLeft >= potentialContext.intervalStart &&
          eventLeft <= potentialContext.intervalEnd
        ) {
          // The event's left edge is splitting us
          distLeft = Math.abs(eventLeft - potentialContext.intervalStart);
          distRight = Math.abs(eventLeft - potentialContext.intervalEnd);
          if (distRight <= distLeft) {
            // Snap left
            eventLeft = potentialContext.intervalStart;
          } else {
            eventLeft = potentialContext.intervalEnd + 1;
          }
        }

        if (
          eventRight >= potentialContext.intervalStart &&
          eventRight <= potentialContext.intervalEnd
        ) {
          // The event's right edge is splitting us
          distLeft = Math.abs(eventRight - potentialContext.intervalStart);
          distRight = Math.abs(eventRight - potentialContext.intervalEnd);
          if (distRight <= distLeft) {
            // Snap right
            eventRight = potentialContext.intervalEnd;
          } else {
            eventRight = potentialContext.intervalStart - 1;
          }
        }

        // Hopefully this never happens?
        if (eventRight < eventLeft) {
          // The event span has disappeared!
          console.log("Error trying to fix overlaps on context creation: Event with ID %s collapsed.", event.eventID);
          abortCreate = true;
        } else {
          if (eventLeft != event.intervalStart || eventRight != event.intervalEnd) {
            App.Events.resizeEvent(event.eventID, eventLeft, eventRight);

            // Redraw the sentence
            App.View.refreshSentence(lineNum);
            Annotator.refreshActiveElements();
          }
        }
      });
      if (abortCreate) {
        continue;
      }

      // Okay, potentialContext is a go
      App.Contexts.newContextAsync(lineNum, potentialContext.intervalStart, potentialContext.intervalEnd, contextText,
        function (msg) {
          // Success callback
          // Server should have sent us back a single Context object
          var newContext = msg.data;
          App.Contexts.pushContextAndRefresh(newContext);
          App.View.refreshSentence(newContext.line_num);
          Annotator.refreshContextList();
          Annotator.refreshActiveElements();
          contextOverflowShadow();
        });
    }
  }

  function falsePositiveHandler(evt) {
    // Deletes the active event
    evt.preventDefault();

    // Sanity checks
    // If the button is disabled or we are not in the 2nd pass, ignore clicks
    if (Annotator.Elements.$markFpButton.hasClass('disabled') ||
      parseInt(App.Paper.annotation_pass) != 2) {
      return
    }
    // The event should be a Reach one
    if (App.Events.events[Annotator.activeEvent].type != "reach") {
      console.log("[ERROR] Tried to mark a non-reach context as a false positive.");
      return
    }

    // Proceed
    var serverID = App.Events.events[Annotator.activeEvent].id;
    var lineNum = App.Events.events[Annotator.activeEvent].line_num;
    console.log("DEBUG: Deleting event: %s", serverID);
    App.Events.toggleFalsePositiveAsync(serverID, function () {
      // Success callback -- Update the local event store and refresh the view
      App.Events.toggleLocalFalsePositiveAndRefresh(serverID);
      App.View.refreshSentence(lineNum);
      Annotator.refreshActiveElements();
    })
  }

})(App);