(function (App) {
  // Data management functions

  App.initData = function () {

    // Convert Paper.sections from a comma-delimited string to a List of Numbers
    App.Paper.sections = App.Paper.sections.split(",");
    $.each(App.Paper.sections, function (index, lineNum) {
      App.Paper.sections[index] = Number(lineNum);
    });

    // Merge the Reach and manual context stores

    App.Contexts.contexts = App.Contexts.reach.concat(App.Contexts.manual);

    // Create a <grounding_id> -> <free_text> database for the contexts in the current paper
    App.Contexts.grounding = createGroundingDB(App.Contexts.contexts);

    // Create a <grounding_category> -> <grounding_id> database for the contexts
    App.Contexts.categorised_groundings = createGroundingCategoryDB(App.Contexts.categories, App.Contexts.contexts);

    // Create events store that uses grounding IDs instead of free text mentions
    App.Events.events = prepEvents(App.Events.raw);

    // The line-indexed versions of the data stores will be kept in sync with each modification using the byLineDirty
    // flag, which will trigger a re-indexing on get when necessary
    App.Contexts.byLine = generateContextsByLine(App.Contexts.contexts);
    App.Contexts.byLineDirty = false;
    App.Contexts.getByLine = function (lineNum) {
      if (App.Contexts.byLineDirty) {
        App.Contexts.byLine = generateContextsByLine(App.Contexts.contexts);
      }
      return App.Contexts.byLine[lineNum];
    };

    App.Events.byLine = generateEventsByLine(App.Events.events);
    App.Events.byLineDirty = false;
    App.Events.getByLine = function (lineNum) {
      if (App.Events.byLineDirty) {
        App.Events.byLine = generateEventsByLine(App.Events.events);
      }
      return App.Events.byLine[lineNum];
    };

    // === Annotation API ===
    App.Paper.getCommentsAsync = function () {
      // Returns a Deferred that will be resolved when the server sends us the current comments
      return App.Websocket.sendRequestAsync({
        command: "get_comments",
        paperID: App.Paper.id
      })
    };

    App.Paper.saveCommentsAsync = function (comments, callback) {
      // Makes an asynchronous request to the server to save the given comments to the given paper ID
      // With an optional callback function to be executed when the server replies
      requestSaveComments(App.Paper.id, comments, callback);
    };

    App.Events.toggleContext = function (eventID, groundingID) {
      var currentEvent = App.Events.events[eventID];

      // If the context is active for the given event, de-activate it; vice versa
      var operation;
      var index = $.inArray(groundingID, currentEvent['groundings']);
      if (index > -1) {
        currentEvent['groundings'].splice(index, 1);
        operation = "del";
      } else {
        currentEvent['groundings'].push(groundingID);
        operation = "add";
      }

      // File a request with the server to reflect the latest changes
      var serverID = currentEvent['id'];
      requestSaveContexts(serverID, currentEvent['groundings']);

      // [Automatic inheritance]
      // If this event span lies completely within a larger event span, then the larger event span should inherit any
      // additions we make to the smaller one here.  Deletions are not guaranteed.
      // Conversely, the smaller span should inherit *deletions* from the larger span. Additions are not guaranteed.
      // (The 2nd annotation pass is basically the only place we will see  such overlaps, and only between Reach and
      // manual events.)

      // TODO: Why did we ever make getByLine return a different format from the raw Event objects?!
      var otherEvents = App.Events.getByLine(currentEvent['line_num']);
      var otherEvent, otherIndex;
      for (var i = 0; i < otherEvents.length; i++) {
        otherEvent = otherEvents[i];
        if (otherEvent['serverID'] == currentEvent['id']) {
          // We found ourselves
          continue;
        }

        if (currentEvent.interval_start >= otherEvent.intervalStart
          && currentEvent.interval_start <= otherEvent.intervalEnd
          && currentEvent.interval_end <= otherEvent.intervalEnd) {
          // A total overlap -- currentEvent is within otherEvent
          otherIndex = $.inArray(groundingID, otherEvent['contexts']);
          if (otherIndex == -1 && operation == "add") {
            otherEvent['contexts'].push(groundingID);
            requestSaveContexts(otherEvent['serverID'], otherEvent['contexts']);
            App.View.createAlert("information", "Also adding context to fully overlapping event...");
          }
          continue;
        }

        if (currentEvent.interval_start <= otherEvent.intervalStart
        && currentEvent.interval_end >= otherEvent.intervalEnd) {
          // A total overlap in the other direction -- otherEvent is within currentEvent
          otherIndex = $.inArray(groundingID, otherEvent['contexts']);
          if (otherIndex > -1 && operation == "del") {
            otherEvent['contexts'].splice(otherIndex, 1);
            requestSaveContexts(otherEvent['serverID'], otherEvent['contexts']);
            App.View.createAlert("information", "Also removing context from fully overlapped event...");
          }
        }
      }
    };

    App.Events.resizeEvent = function (eventID, newStart, newEnd) {
      // App.Events.events is a list of event objects, as sent by the server.
      // Start by refreshing the client's view
      App.Events.events[eventID]['interval_start'] = newStart;
      App.Events.events[eventID]['interval_end'] = newEnd;
      App.Events.byLineDirty = true;

      // Then file a request with the server to save the changes
      // TODO: More intelligent debouncing here.  We only want to debounce if the serverID is the same.
      // TODO: Turn off debouncing for now, since resizing is disabled anyway.
      var serverID = App.Events.events[eventID]['id'];
      requestEventResize(serverID, newStart, newEnd);

      console.log("DEBUG: Event %s resized. New indices: %s, %s.", eventID, newStart, newEnd);
    };

    App.Contexts.findInstances = function (contextText) {
      // Searches through the paper to find instances of the given context word/phrase.
      // Returns a List of Objects: lineNum => line number
      //                            intervalStart => index of starting word
      //                            intervalEnd => index of ending word
      var contextWords = contextText.split(" ");
      var potentialInstances = [];

      for (var lineNum = 0; lineNum < App.Paper.sentences.length; lineNum++) {
        var sentenceWords = App.Paper.sentences[lineNum].split(" ");
        for (var wordIndex = 0; wordIndex < sentenceWords.length; wordIndex++) {
          // Look for a potential match that fits within the remaining words
          if (
            sentenceWords[wordIndex] == contextWords[0] &&
            (wordIndex + contextWords.length - 1) < sentenceWords.length
          ) {
            var potentialFound = true;
            // Lookahead
            for (var contextIndex = 1; contextIndex < contextWords.length; contextIndex++) {
              if (sentenceWords[wordIndex + contextIndex] != contextWords[contextIndex]) {
                potentialFound = false;
              }
            }
            if (potentialFound) {
              potentialInstances.push({
                lineNum: lineNum,
                intervalStart: wordIndex,
                intervalEnd: wordIndex + contextWords.length - 1
              })
            }
          }
        }
      }

      return potentialInstances;
    };

    // === Events ===

    App.Events.newEventAsync = function (lineNum, newStart, newEnd, callback) {
      // Makes an asynchronous request to the server to create the given event.
      // The server will respond with the details of the created event, if successful
      requestNewEvent(App.Paper.id, lineNum, newStart, newEnd, callback);
    };

    App.Events.pushLocalEventAndRefresh = function (newEvent) {
      // Given an event object from the server, prep it and add it to the event store
      // Inserts it into the events array at the appropriate spot:
      // - Sorted by line_num, then by interval_start, which is the way the server should be sending them
      // Also returns the final index of the new event in the event store

      var newIndex;
      // Does the new event come after the last current event?
      var lastEvent = App.Events.events[App.Events.events.length - 1];
      if (
        App.Events.events.length == 0 ||
        newEvent.line_num > lastEvent.line_num ||
        (newEvent.line_num == lastEvent.line_num && newEvent.interval_start >= lastEvent.interval_start)
      ) {
        // If so, just push the new event
        App.Events.events.push(newEvent);
        newIndex = App.Events.events.length - 1;
      } else {
        // If not, we'll need to search for our spot
        for (var i = 0; i < App.Events.events.length; i++) {
          var event = App.Events.events[i];
          if (newEvent.line_num < event.line_num) {
            // No contest, insert before this event
            App.Events.events.splice(i, 0, newEvent);
            newIndex = i;
            break;
          } else if (event.line_num == newEvent.line_num) {
            // Same line, check start interval
            if (newEvent.interval_start < event.interval_start) {
              App.Events.events.splice(i, 0, newEvent);
              newIndex = i;
              break;
            }
          }
        }
      }

      // Re-index and re-categorise events
      App.Events.events = prepEvents(App.Events.events);
      App.Events.byLineDirty = true;

      return newIndex;
    };

    App.Events.deleteEventAsync = function (serverID, callback) {
      // Ask the server to delete the given event
      requestDeleteEvent(App.Paper.id, serverID, callback);
    };

    App.Events.removeLocalEventAndRefresh = function (serverID) {
      // Remove the event with the given serverID from the local store
      // mark the byLine store as dirty, and re-index the events store
      for (var i = 0; i < App.Events.events.length; i++) {
        var event = App.Events.events[i];
        if (event.id == serverID) {
          App.Events.events.splice(i, 1);
          break;
        }
      }
      // Re-index and re-categorise events
      App.Events.events = prepEvents(App.Events.events);
      App.Events.byLineDirty = true;
    };

    App.Events.setGroundings = function (serverID, groundings) {
      // Manually sets all the groundings for the event with the given serverID
      requestSaveContexts(serverID, groundings);
    };

    App.Events.toggleFalsePositiveAsync = function (serverID, callback) {
      requestFalsePositive(App.Paper.id, serverID, callback);
    };

    App.Events.toggleLocalFalsePositiveAndRefresh = function (serverID) {
      // Toggle the false positive marking on the given event and refresh the store
      for (var i = 0; i < App.Events.events.length; i++) {
        var event = App.Events.events[i];
        if (event.id == serverID) {
          App.Events.events[i]['false_positive'] = !(App.Events.events[i]['false_positive']);
          break;
        }
      }
      // Re-index and re-categorise events
      App.Events.events = prepEvents(App.Events.events);
      App.Events.byLineDirty = true;
    };

    // === Contexts ===

    App.Contexts.newContextAsync = function (lineNum, newStart, newEnd, contextText, callback) {
      // Makes an asynchronous request to the server to create the given context.
      // The server will respond with details of the created context, if successful
      requestNewContext(App.Paper.id, lineNum, newStart, newEnd, contextText, callback);
    };

    App.Contexts.refreshGroundings = function () {
      // Two grounding stores: `grounding` is an object mapping grounding IDs to an array of their associated free-text
      // mentions. `categorised_groundings` is a List of Lists: [<description>, [<prefix>, ...]]. We're using a list to
      // preserve the relative hierarchy of context categories.
      App.Contexts.grounding = createGroundingDB(App.Contexts.contexts);
      App.Contexts.categorised_groundings = createGroundingCategoryDB(App.Contexts.categories, App.Contexts.contexts);
    };

    App.Contexts.pushContextAndRefresh = function (newContext) {
      // Given a context object from the server, add it to the context store and refresh the grounding store
      App.Contexts.contexts.push(newContext);
      App.Contexts.byLineDirty = true;
      App.Contexts.refreshGroundings();
    };

    App.Contexts.deleteContextAsync = function (serverID, callback) {
      // Ask the server to delete the given context
      requestDeleteContext(App.Paper.id, serverID, callback);
    };

    App.Contexts.removeContextAndRefresh = function (serverID) {
      // Remove the context with the given serverID from the local stores and refresh the groundings
      for (var i = 0; i < App.Contexts.contexts.length; i++) {
        var context = App.Contexts.contexts[i];
        if (context.id == serverID) {
          App.Contexts.contexts.splice(i, 1);
          break;
        }
      }
      App.Contexts.byLineDirty = true;
      App.Contexts.refreshGroundings();
    }
  };

  // === Private functions ===
  function mergeContexts(reachContexts, manualContexts) {
    // Merge Reach and manual contexts
    // Start by copying the Reach context store so that we don't modify the originals
    // (Since Javascript passes objects by reference)
    var mergedContexts = {};
    $.extend(mergedContexts, reachContexts);

    // Manually extend it with the manual context store
    $.each(manualContexts, function (contextText, intervalMap) {
      if (mergedContexts.hasOwnProperty(contextText)) {
        // The manualContext was also picked up by Reach.
        // Update the lineNum -> interval mappings
        $.each(intervalMap, function (lineNum, intervalList) {
          // manualContexts also includes an annotationID for matching manualEvents
          // Copy it over to mergedContexts and carry on
          if (lineNum == "annotationID") {
            mergedContexts[contextText][lineNum] = intervalList;
            return;
          }
          // It might also contain a groundingID (since the TSVs have been curated)
          if (lineNum == "groundingID") {
            mergedContexts[contextText][lineNum] = intervalList;
            return;
          }

          if (mergedContexts[contextText].hasOwnProperty(lineNum)) {
            // Reach found a context on the same line as the manualContext.
            // Loop over the intervals, add any that were in manualContext but not reachContext
            var reachIntervals = mergedContexts[contextText][lineNum];
            $.each(intervalList, function (index, interval) {
              if ($.inArray(interval, reachIntervals) === -1) {
                mergedContexts[contextText][lineNum].push(interval);
              }
            });
          } else {
            mergedContexts[contextText][lineNum] = intervalList;
          }
        });
      } else {
        // The manualContext was not picked up by Reach.
        // Copy it over and move on.
        console.log("[" + "%cDEBUG" + "%c] Manually-annotated context '%s' was not picked up by Reach.",
          "color:blue", "color:black", contextText);
        mergedContexts[contextText] = intervalMap;
      }
    });

    return mergedContexts;
  }

  function createGroundingDB(contexts) {
    // Object: <grounding ID> -> list of free-text mentions
    var groundingDB = {};

    // `contexts` should be a list of context objects, as sent by the server and described in data-load.js
    // Specifically, we will use context.grounding_id and context.free_text
    $.each(contexts, function (index, context) {
      if (!groundingDB.hasOwnProperty(context.grounding_id)) {
        groundingDB[context.grounding_id] = [];
      }

      if ($.inArray(context.free_text, groundingDB[context.grounding_id]) === -1) {
        groundingDB[context.grounding_id].push(context.free_text);
      }
    });

    // Sort the list of free text mentions for each context
    $.each(groundingDB, function (groundingID, textList) {
      groundingDB[groundingID] = textList.sort();
    });
    return groundingDB;
  }

  function createGroundingCategoryDB(categories, contexts_original) {
    // Creates the following database:
    // List: Category label -> List of relevant grounding IDs (unsorted)
    var groundingCategoryDB = [];

    // Shallow copy of context store that we will use to populate the DB
    var contexts = [].concat(contexts_original);

    $.each(categories, function (index, category) {
      // Category is a Tuple: (<description>, [<prefix>, ...])
      var description = category[0];
      var groundings = [];
      var prefixRegex = new RegExp("^(" + category[1].join("|") + ")");

      // Loop over the copy of contexts, splicing elements out if they match any of the prefixes
      for (var i = contexts.length - 1; i >= 0; i--) {
        var currentGrounding = contexts[i]['grounding_id'];
        if (prefixRegex.test(currentGrounding)) {
          if ($.inArray(currentGrounding, groundings) === -1) {
            groundings.push(currentGrounding);
          }
          contexts.splice(i, 1);
        }
      }

      groundingCategoryDB.push([description, groundings]);
    });

    // Anything remaining in the copy of contexts is labelled Misc
    var miscGroundings = [];
    $.each(contexts, function (index, context) {
      if ($.inArray(context['grounding_id'], miscGroundings) === -1) {
        miscGroundings.push(context['grounding_id']);
      }
    });
    groundingCategoryDB.push(["Manual/Misc.", miscGroundings]);

    return groundingCategoryDB;
  }

  function createGroundingID(contextText) {
    // Called when the data loaded doesn't contain a grounding ID for some text
    return "manual:" + contextText.replace(/ /g, "-");
  }

  function prepEvents(rawEvents) {
    // Adds (local) eventIDs, colour categories, and other metadata to raw events
    // Events should have the following properties:
    // - eventID (int)
    // - id (int, from the server)
    // - category (int)
    // - line_num (int)
    // - interval_start (int)
    // - interval_end(int)
    // - groundings (array)
    // - paper_id (str)
    // - type (str)
    // - false_positive (boolean)

    var preppedEvents = [];
    $.extend(preppedEvents, rawEvents);
    $.each(preppedEvents, function (index, event) {
      event['eventID'] = index;
      // Colour-coded categories
      if (event['type'] == "reach") {
        if (event['false_positive']) {
          event['category'] = 2;
        } else {
          event['category'] = 0;
        }
      } else if (event['type'] == "manual") {
        event['category'] = 1;
      } else {
        console.log("Unknown event type for event %s.", index);
      }
    });
    return preppedEvents;
  }

  function groundEvents(contexts, ungroundedEvents) {
    // Converts events to use lists of grounding IDs as contexts (instead of lists of free-text mentions)
    var groundedEvents = [];

    // Extend before modification to preserve originals
    $.extend(groundedEvents, ungroundedEvents);

    $.each(groundedEvents, function (index, event) {
      var contextList;
      contextList = $.map(event['contexts'], function (contextText) {
        return contexts[contextText]['groundingID'];
      });
      event['contexts'] = contextList;
    });

    return groundedEvents;
  }

  function generateContextsByLine(contexts) {
    // Object: <line no> -> list of objects: 'contextText' -> context.free_text
    //                                       'intervalStart' -> context.interval_start,
    //                                       'intervalEnd' -> context.interval_end,
    //                                       'groundingID' -> context.grounding_id
    //                                       'serverID' -> context.id (the database ID for the context mention)
    //                                       'type' -> context.type
    var contextsByLine = {};

    // `contexts` is a list of context objects as sent by the server
    $.each(contexts, function (index, context) {
      if (!contextsByLine.hasOwnProperty(context.line_num)) {
        contextsByLine[context.line_num] = [];
      }

      contextsByLine[context.line_num].push({
        contextText: context.free_text,
        intervalStart: context.interval_start,
        intervalEnd: context.interval_end,
        groundingID: context.grounding_id,
        serverID: context.id,
        type: context.type
      });
    });

    return contextsByLine;
  }

  function generateEventsByLine(events) {
    // TODO: Consolidate this; we don't need two separate property lists
    // Object: <line no> -> list of objects: 'contexts' -> event.groundings (list of associated grounding IDs)
    //                                       'intervalStart' -> event.interval_start,
    //                                       'intervalEnd' -> event.interval_end,
    //                                       'eventID' -> event.eventID,
    //                                       'category' -> event.category,
    //                                       'serverID' -> event.id (the database ID for the event mention)
    //                                       'type' -> event.type
    var eventsByLine = {};

    // `events` is a list of event objects as sent by the server
    $.each(events, function (index, event) {
      if (!eventsByLine.hasOwnProperty(event.line_num)) {
        eventsByLine[event.line_num] = [];
      }

      eventsByLine[event.line_num].push({
        contexts: event.groundings,
        intervalStart: event.interval_start,
        intervalEnd: event.interval_end,
        eventID: event.eventID,
        category: event.category,
        serverID: event.id,
        type: event.type
      });
    });

    return eventsByLine;
  }

  // === Requests to Server ===
  function alertChangesSaved(customMessage) {
    var alertString = "Changes saved to server.";
    if (customMessage !== undefined) {
      alertString = customMessage;
    }
    App.View.createAlert(
      "success",
      alertString
    );
  }

  // Debounce the success alert -- We don't need to see it so many times
  alertChangesSaved = App.Util.debounce(alertChangesSaved, 500);

  function alertChangesFailed() {
    App.View.createAlert(
      "error",
      "Could not save changes to server."
    );
  }

  function requestEventResize(serverID, newStart, newEnd) {
    // Dials the server and asks for an event to be resized
    // Uses *server* ID, not client's eventID
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'resize_event',
      serverID: serverID,
      newStart: newStart,
      newEnd: newEnd
    });
    $.when(serverResponse).done(function (msg) {
      alertChangesSaved();
    });
    $.when(serverResponse).fail(function () {
      alertChangesFailed();
      // TODO: Somewhat more sophisticated error handling might be needed here... (e.g., refresh the page, etc.)
    });
  }

  function requestSaveContexts(serverID, groundings) {
    // Sends the given event's list of groundings to the server to update the DB
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'save_event_contexts',
      serverID: serverID,
      groundings: groundings
    });
    $.when(serverResponse).done(function (msg) {
      alertChangesSaved();
    });
    $.when(serverResponse).fail(function () {
      alertChangesFailed();
      // TODO: Somewhat more sophisticated error handling might be needed here... (e.g., refresh the page, etc.)
    });
  }

  function requestSaveComments(paperID, comments, callback) {
    // Sends a (new) comment string for the given paper ID.
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'save_comments',
      paperID: paperID,
      comments: comments
    });
    $.when(serverResponse)
      .done(function (msg) {
        alertChangesSaved();
      })
      .fail(function () {
        alertChangesFailed();
      })
      .always(callback);
  }

  // Debounce so that it doesn't fire on *every* single comments change
  requestSaveComments = App.Util.debounce(requestSaveComments, 750);

  // --- Events ---
  function requestNewEvent(paperID, lineNum, newStart, newEnd, callback) {
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'new_event',
      paperID: paperID,
      lineNum: lineNum,
      newStart: newStart,
      newEnd: newEnd
    });
    $.when(serverResponse)
      .done(function (msg) {
        alertChangesSaved("Created new event on line " + lineNum + " (" + newStart + "-" + newEnd + ")");
        callback(msg);
      })
      .fail(function () {
        alertChangesFailed();
        // TODO: Error handling
      });
  }

  function requestDeleteEvent(paperID, serverID, callback) {
    // Asks the server to delete a given event
    // Includes the paper ID as a basic sanity check
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'delete_event',
      paperID: paperID,
      serverID: serverID
    });
    $.when(serverResponse)
      .done(function (msg) {
        alertChangesSaved("Event deleted.");
        callback(msg);
      })
      .fail(function () {
        alertChangesFailed();
        // TODO: Error handling
      });
  }

  function requestFalsePositive(paperID, serverID, callback) {
    // Asks the server to toggle a given Reach event's false positive marking
    // Includes the paper ID as a basic sanity check
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'false_positive',
      paperID: paperID,
      serverID: serverID
    });
    $.when(serverResponse)
      .done(function (msg) {
        alertChangesSaved("Changed the event's FP status.");
        callback(msg);
      })
      .fail(function () {
        alertChangesFailed();
        // TODO: Error handling
      });
  }

  // --- Contexts ---
  function requestNewContext(paperID, lineNum, newStart, newEnd, contextText, callback) {
    // Asks the server to give us a new context
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'new_context',
      paperID: paperID,
      lineNum: lineNum,
      newStart: newStart,
      newEnd: newEnd,
      contextText: contextText
    });
    $.when(serverResponse)
      .done(function (msg) {
        alertChangesSaved("Created new contexts: " + msg.data.free_text);
        callback(msg);
      })
      .fail(function () {
        alertChangesFailed();
        // TODO: Error handling
      });
  }

  function requestDeleteContext(paperID, serverID, callback) {
    // Asks the server to delete a given context
    // Includes the paper ID as a basic sanity check
    var serverResponse = App.Websocket.sendRequestAsync({
      command: 'delete_context',
      paperID: paperID,
      serverID: serverID
    });
    $.when(serverResponse)
      .done(function (msg) {
        alertChangesSaved("Context mention deleted.");
        callback(msg);
      })
      .fail(function () {
        alertChangesFailed();
        // TODO: Error handling
      });
  }

})(App);
