(function (App) {
  // The functions in this file mark up and display HTML content to the user.
  // They all live within the App.View namespace.
  var View = {};

  // Will contain jQuery objects corresponding to important DOM elements
  View.Elements = {};

  View.initView = function (mode) {
    // Load the paper view HTML and refresh Foundation
    // If mode is "print", prepare a full width text view without the sidebar

    $("#main-wrapper")
      .html(createPaperViewHTML(mode))
      .foundation();

    // Cache DOM elements
    View.Elements.$paperTitle = $("#head-paper-title");
    View.Elements.$mainText = $("#main-paper-text");

    // Title
    View.Elements.$paperTitle.html(App.Paper.title);

    // This array will be .join()-ed to give the main html string.
    var mainHTMLList = [];
    for (var lineNum = 0; lineNum < App.Paper.sentences.length; lineNum++) {
      // Section breaks
      if (lineNum > 0 && $.inArray(lineNum, App.Paper.sections) > -1) {
        mainHTMLList.push("<hr>");
      }
      // Inter-sentence spacing
      mainHTMLList.push(" ");

      // Sentence numbers
      mainHTMLList.push("<sup id='sentence-number-" + lineNum + "' class='sentence-number'>(" + lineNum + ")</sup>");

      // Sentence containers, which contain the marked up sentences
      mainHTMLList.push("<span id='sentence-" + lineNum + "' class='sentence'>");
      // Pre-process the event/context span data for the current line before marking it up
      preprocessLine(lineNum);
      mainHTMLList.push(markupSentence(lineNum));
      mainHTMLList.push("</span>");
    }

    // Display the initial view
    View.Elements.$mainText.html(mainHTMLList.join(""));

  };

  View.refreshSentence = function (lineNum) {
    // Marks up and redraws the given sentence
    preprocessLine(lineNum);
    var $target = $('#sentence-' + lineNum);
    $target.html(markupSentence(lineNum));
  };

  View.createAlert = function (type, text, timeout) {
    if (timeout === undefined) timeout = 2000;

    var n = noty({
      text: text,
      theme: 'relax',
      layout: 'topLeft',
      type: type,
      timeout: timeout
    });
  };

  // Transfer to namespace
  App.View = View;

  // === Private functions ===
  function createPaperViewHTML(mode) {
    // Returns the HTML template for the per-paper view
    // Goes into #main-wrapper

    if (mode == "print") {
      // Print version has no sidebar, and has full-width main text column
      return "\
      <div id='main-container' class='row column shadow'>\
        <div id='main-content' class='row'>\
          <div class='small-10 small-centered columns'>\
            <div id='header' class='row column'>\
              <h3 id='head-paper-title'>Loading...</h3>\
            </div>\
            <hr>\
            <div id='main-paper-text'>\
              Loading...\
            </div>\
          </div>\
        </div>\
      </div>\
      ";
    } else {
      // Display version has sidebar
      return "\
      <div id='main-container' class='row column shadow'>\
        <div id='main-content' class='row'>\
          <div class='small-8 large-8 columns'>\
            <div id='header' class='row column'>\
              <h3 id='head-paper-title'>Loading...</h3>\
            </div>\
            <hr>\
            <div id='main-paper-text'>\
              Loading...\
            </div>\
          </div>\
          <div class='small-4 large-4 columns' data-sticky-container>\
            <div class='sticky' id='side-status-container'\
                 data-sticky\
                 data-margin-top='3'\
                 data-top-anchor='main-content:top'\
                 >\
              <div id='side-status' class='shadow callout'>\
                Loading...\
              </div>\
            </div>\
          </div>\
        </div>\
      </div>\
      ";
    }


  }

  function markupSentence(lineNum) {
    // Adds HTML markup (i.e., context and event spans) to the given sentence
    var sentenceText = App.Paper.sentences[lineNum];
    var sentenceWords = sentenceText.split(/\s+/);

    // Markup: Contexts first, so that event spans can take scope later
    var lineContexts = App.Contexts.getByLine(lineNum);
    $.each(lineContexts, function (index, context) {
      var contextStart = context['intervalStart'],
        contextEnd = context['intervalEnd'],
        contextText = context['contextText'],
        contextGrounding = context['groundingID'],
        contextType = context['type'],
        contextServerID = context['serverID'];

      sentenceWords[contextStart] = "<span class='context deselected-context " +
        contextText.replace(/ /g, "-") + "-context-text " +
        contextGrounding.replace(/:/g, "-") + "-context-grounding " +
        contextType + "-context-type' " +
        "data-context-text='" + contextText + "' " +
        "data-context-grounding='" + contextGrounding + "' " +
        "data-context-server-id='" + contextServerID + "' " +
        "data-line-num='" + lineNum + "'>" +
        sentenceWords[contextStart];
      sentenceWords[contextEnd] += "</span>";
    });

    // Markup: Events
    var lineEvents = App.Events.getByLine(lineNum);
    $.each(lineEvents, function (index, event) {
      var eventStart = event['intervalStart'],
        eventEnd = event['intervalEnd'],
        eventID = event['eventID'],
        eventCat = event['category'];

      sentenceWords[eventStart] = "<span class='event event-cat-" + eventCat + "' id='event-" + eventID + "'>"
        + sentenceWords[eventStart];
      sentenceWords[eventEnd] += "</span>";
    });

    // Generate and prettify HTML
    var sentenceHTML = sentenceWords.join(" ");
    return prettifyHTMLText(sentenceHTML);
  }

  function preprocessLine(lineNum) {
    // Fixes overlaps and punctuation in event/context spans.
    var sentenceText = App.Paper.sentences[lineNum];
    var sentenceWords = sentenceText.split(" ");
    var lineEvents;

    if (!App.Config.View.showReachEvents) {
      // showReachEvents is off.  Remove Reach events from the client data store.
      // Prioritise over other pre-processing steps so that the Reach events don't get in the way
      lineEvents = App.Events.getByLine(lineNum);
      $.each(lineEvents, function (index, event) {
        if (event.type == "reach") {
          App.Events.removeLocalEventAndRefresh(event.serverID);
          console.log("Reach event with serverID %s on line %s hidden.",
            event.serverID,
            lineNum
          )
        }
      });
    }

    if (App.Config.View.eventsIncludePunctuation) {
      // Fix event punctuation on all events
      // (This should fix -- or at least not cause -- any punctuation based overlaps between events)
      lineEvents = App.Events.getByLine(lineNum);
      $.each(lineEvents, function (index, event) {
        var eventStart = event['intervalStart'],
          eventEnd = event['intervalEnd'],
          eventID = event['eventID'];
        var testPunctuation;
        var origStart = eventStart, origEnd = eventEnd;

        // On starting word of event span
        testPunctuation = sentenceWords[eventStart];
        while ($.inArray(testPunctuation, App.Config.View.endPunctuation) > -1) {
          if (eventEnd > eventStart) {
            // We can afford to resize the span
            eventStart += 1;
            console.log("Moved start index for event %s. New event text: %s",
              eventID,
              sentenceWords.slice(eventStart, eventEnd + 1).join(" "));
            testPunctuation = sentenceWords[eventStart];
          } else {
            // Something's wrong here... The span consists only of a punctuation mark.
            // Don't do anything, but log a warning
            console.log("WARNING: Event %s appears to consist of only punctuation. Text: %s",
              eventID,
              sentenceWords.slice(eventStart, eventEnd + 1).join(" "));
            testPunctuation = "";
          }
        }
        // A bit more dangerous -- Expand the span
        testPunctuation = sentenceWords[eventStart - 1];
        while ($.inArray(testPunctuation, App.Config.View.startPunctuation) > -1) {
          eventStart -= 1;
          console.log("Moved start index for event %s. New event text: %s",
            eventID,
            sentenceWords.slice(eventStart, eventEnd + 1).join(" "));
          testPunctuation = sentenceWords[eventStart - 1];
        }

        // On ending word
        testPunctuation = sentenceWords[eventEnd];
        while ($.inArray(testPunctuation, App.Config.View.startPunctuation) > -1) {
          if (eventStart < eventEnd) {
            // We can afford to resize the span
            eventEnd -= 1;
            console.log("Moved end index for event %s. New event text: %s",
              eventID,
              sentenceWords.slice(eventStart, eventEnd + 1).join(" "));
            testPunctuation = sentenceWords[eventEnd];
          } else {
            // Something's wrong here... The span consists only of a punctuation mark.
            // Don't do anything, but log a warning
            console.log("WARNING: Event %s appears to consist of only punctuation. Text: %s",
              eventID,
              sentenceWords.slice(eventStart, eventEnd + 1).join(" "));
            testPunctuation = "";
          }
        }
        // And expanding
        testPunctuation = sentenceWords[eventEnd + 1];
        while ($.inArray(testPunctuation, App.Config.View.endPunctuation) > -1) {
          eventEnd += 1;
          console.log("Moved end index for event %s. New event text: %s",
            eventID,
            sentenceWords.slice(eventStart, eventEnd + 1).join(" "));
          testPunctuation = sentenceWords[eventEnd + 1];
        }

        // Update events store
        eventStart = Math.max(eventStart, 0);
        eventEnd = Math.min(eventEnd, sentenceWords.length - 1);
        if (eventStart != origStart || eventEnd != origEnd) {
          App.Events.resizeEvent(eventID, eventStart, eventEnd);
        }
      });
    }

    // Iterators and temporary variables for overlap handling
    var i, j, manualEvent, reachEvent, currentEvent, compareEvent;

    if (App.Config.View.handleReachManualEventOverlaps) {
      // Before attempting to handle generic overlaps, apply special handling for 2nd annotation pass.
      // TODO: Make more efficient?
      lineEvents = App.Events.getByLine(lineNum);
      if (lineEvents !== undefined) {
        // Find manual events
        for (i = 0; i < lineEvents.length; i++) {
          if (lineEvents[i].type == "manual") {
            // Found one. Look for Reach event overlaps.
            // (We don't expect any manual event overlaps, unless something has gone horribly wrong -- They should be
            // blocked by the UI)
            // TODO: Should probably put in a server-side check as well
            manualEvent = lineEvents[i];

            for (j = 0; j < lineEvents.length; j++) {
              if (lineEvents[j].type == "reach") {
                reachEvent = lineEvents[j];

                // Reach event within manual event
                if (reachEvent.intervalStart >= manualEvent.intervalStart
                  && reachEvent.intervalStart <= manualEvent.intervalEnd
                  && reachEvent.intervalEnd <= manualEvent.intervalEnd) {
                  // Reach event should inherit manual event's contexts.
                  // DEBUG: Disabled: With this implementation, we imply that the overlapping Reach event should
                  // *always* have the same contexts as the manual one, which is probably not true.
                  // App.Events.setGroundings(reachEvent.serverID, manualEvent.contexts);
                  // App.Events.events[reachEvent.eventID].groundings =
                  //   App.Events.events[manualEvent.eventID].groundings;

                  // Reach event will be properly hidden later if hideOverlappingEvents is on
                  continue;
                }

                // TODO: Manual event within Reach event
                // Can be handled by just having the manual span overlap the Reach one, but we need to make sure it
                // doesn't accidentally get wiped out by the overlap handling below

                // Reach event juts out to the left
                if (reachEvent.intervalStart < manualEvent.intervalStart
                  && reachEvent.intervalEnd >= manualEvent.intervalStart
                  && reachEvent.intervalEnd <= manualEvent.intervalEnd) {
                  // Reach event should inherit manual event's contexts.
                  // App.Events.setGroundings(reachEvent.serverID, manualEvent.contexts);
                  // App.Events.events[reachEvent.eventID].groundings =
                  //   App.Events.events[manualEvent.eventID].groundings;

                  // Resize reach event *client-side* so that it ends 1 word before the manual event starts,
                  // refresh and reset inner loop
                  App.Events.events[reachEvent.eventID]['interval_end'] =
                    parseInt(App.Events.events[manualEvent.eventID]['interval_start']) - 1;
                  App.Events.byLineDirty = true;
                  lineEvents = App.Events.getByLine(lineNum);
                  j = -1;
                  continue;
                }

                // Reach event juts out to the right
                if (reachEvent.intervalStart >= manualEvent.intervalStart
                  && reachEvent.intervalStart <= manualEvent.intervalEnd
                  && reachEvent.intervalEnd > manualEvent.intervalEnd) {
                  // Reach event should inherit manual event's contexts.
                  // App.Events.setGroundings(reachEvent.serverID, manualEvent.contexts);
                  // App.Events.events[reachEvent.eventID].groundings =
                  //   App.Events.events[manualEvent.eventID].groundings;

                  // Resize reach event *client-side* so that it starts 1 word after the manual event ends,
                  // refresh and reset inner loop
                  App.Events.events[reachEvent.eventID]['interval_start'] =
                    parseInt(App.Events.events[manualEvent.eventID]['interval_end']) + 1;
                  App.Events.byLineDirty = true;
                  lineEvents = App.Events.getByLine(lineNum);
                  j = -1;
                  continue;
                }

              }
            }
          }
        }
      }
    }

    if (App.Config.View.hideOverlappingEvents) {
      // hideOverlappingEvents is on.  Remove overlapping events from the client data store completely.
      lineEvents = App.Events.getByLine(lineNum);
      // Make sure the line has events
      if (lineEvents !== undefined) {
        for (i = 0; i < lineEvents.length; i++) {
          currentEvent = lineEvents[i];

          for (j = i + 1; j < lineEvents.length; j++) {
            compareEvent = lineEvents[j];

            // Events fully overlap.
            if (compareEvent.intervalStart >= currentEvent.intervalStart
              && compareEvent.intervalStart <= currentEvent.intervalEnd
              && compareEvent.intervalEnd <= currentEvent.intervalEnd) {
              // compareEvent completely within currentEvent

              // ** If compareEvent is a manualEvent, show it anyway
              if (compareEvent.type != "reach") {
                continue;
              }

              console.log("Event with serverID %s is completely within event with serverID %s on line %s; hiding.",
                compareEvent.serverID,
                currentEvent.serverID,
                lineNum
              );
              App.Events.removeLocalEventAndRefresh(compareEvent.serverID);
              // Drop the iterator variable by one and refresh the array to look at the current index again
              // (on the inner loop)
              lineEvents = App.Events.getByLine(lineNum);
              j -= 1;
              continue;
            }

            if (currentEvent.intervalStart >= compareEvent.intervalStart
              && currentEvent.intervalStart <= compareEvent.intervalEnd
              && currentEvent.intervalEnd <= compareEvent.intervalEnd) {
              // currentEvent completely within compareEvent

              // ** If currentEvent is a manualEvent, show it anyway
              if (currentEvent.type != "reach") {
                continue;
              }

              console.log("Event with serverID %s is completely within event with serverID %s on line %s; hiding.",
                currentEvent.serverID,
                compareEvent.serverID,
                lineNum
              );
              App.Events.removeLocalEventAndRefresh(currentEvent.serverID);
              // Drop the iterator variable by one and refresh the array to look at the current index again
              // (on the outer loop)
              lineEvents = App.Events.getByLine(lineNum);
              i -= 1;
              break;
            }

            // Events only partially overlap.  Hide the later one.
            if (compareEvent.intervalStart >= currentEvent.intervalStart
              && compareEvent.intervalStart <= currentEvent.intervalEnd) {
              // compareEvent starts in the middle of currentEvent
              console.log("Event with serverID %s overlaps event with serverID %s on line %s; hiding.",
                compareEvent.serverID,
                currentEvent.serverID,
                lineNum
              );
              App.Events.removeLocalEventAndRefresh(compareEvent.serverID);
              // Drop the iterator variable by one and refresh the array to look at the current index again
              // (on the inner loop)
              lineEvents = App.Events.getByLine(lineNum);
              j -= 1;
              continue;
            }

            if (currentEvent.intervalStart >= compareEvent.intervalStart
              && currentEvent.intervalStart <= compareEvent.intervalEnd) {
              // currentEvent starts in the middle of compareEvent
              console.log("Event with serverID %s overlaps event with serverID %s on line %s; hiding.",
                currentEvent.serverID,
                compareEvent.serverID,
                lineNum
              );
              App.Events.removeLocalEventAndRefresh(currentEvent.serverID);
              // Drop the iterator variable by one and refresh the array to look at the current index again
              // (on the outer loop)
              lineEvents = App.Events.getByLine(lineNum);
              i -= 1;
              break;
            }
          }
        }
      }
    }

    // TODO: Fix other kinds of overlaps here as necessary.
    // TODO: As an init, we probably want to make sure that *no* event spans overlap with one another, *no* context
    // spans overlap with one another, and *no* event spans overlap halfway with multi-word contexts.
  }

  function prettifyHTMLText(HTMLText) {
    // Removes trailing spaces on startPunctuation, removes leading spaces on endPunctuation
    // This function must *only* delete from the sentence text; it should not add to it.
    // (getClosestWordIndex in annotator.js depends on this, unless it can be refactored)
    $.each(App.Config.View.startPunctuation, function (index, punctuation) {
      // startPunctuation -- Remove trailing spaces
      var punctuationRE = new RegExp("[" + punctuation + "] ");
      while (punctuationRE.test(HTMLText)) {
        HTMLText = HTMLText.replace(punctuationRE, punctuation);
      }
    });
    $.each(App.Config.View.endPunctuation, function (index, punctuation) {
      // endPunctuation -- Remove leading spaces
      var punctuationRE = new RegExp(" [" + punctuation + "]");
      while (punctuationRE.test(HTMLText)) {
        HTMLText = HTMLText.replace(punctuationRE, punctuation);
      }
    });
    return HTMLText;
  }

})(App);