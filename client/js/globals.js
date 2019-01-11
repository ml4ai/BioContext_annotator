// Record of the application-wide shared variables that will be referenced/modified/otherwise used by the various
// application components.
// The system may be refactored to use a different framework (e.g., Require.js) in the future if necessary.

// All shared variables will be under the App namespace
var App = {};

// -- Data stores
// Structure:
// [data-load.js]
//  method loadData()
//  obj    Paper
//  prop   Paper.title
//  prop   Paper.sentences
//  prop   Paper.sections
//  obj    Contexts
//  prop   Contexts.reach
//  prop   Contexts.manual
//  obj    Events
//  prop   Events.raw


// [data-init.js]
//  method initData()
//  prop   Contexts.contexts
//  prop   Contexts.grounding
//  prop   Contexts.byLine
//  prop   Contexts.byLineDirty
//  method Contexts.getByLine(lineNum)
//  prop   Events.events
//  prop   Events.byLine
//  prop   Events.byLineDirty
//  method Events.getByLine(lineNum)
//  method Events.resizeEvent(eventID, newStart, newEnd)
//  method Events.newEvent(lineNum, newStart, newEnd, newCategory)

// [view.js]
//  obj    View
//  obj    View.Config
//    obj    View.Config.Containers
//      prop   View.Config.Containers.$paperTitle
//      prop   View.Config.Containers.$mainText
//    prop   View.Config.startPunctuation
//    prop   View.Config.endPunctuation
//  method View.initView()
//  method View.refreshSentence(lineNum)
//  method View.createAlert(type, text)

// [annotator.js]
//  obj    Annotator
//  obj    Annotator.Config
//    obj    Annotator.Config.Containers
//      prop   Annotator.Config.Containers.$sidebarContainer
//      prop   Annotator.Config.Containers.$sidebar
//      prop   Annotator.Config.Containers.$mainPaperText
//      prop   Annotator.Config.Containers.$sideStatusNav
//      prop   Annotator.Config.Containers.$sideStatusEventActive
//      prop   Annotator.Config.Containers.$sideStatusEventTotal
//      prop   Annotator.Config.Containers.$jumpButton
//      prop   Annotator.Config.Containers.$jumpID
//      prop   Annotator.Config.Containers.$prevButton
//      prop   Annotator.Config.Containers.$scrollButton
//      prop   Annotator.Config.Containers.$nextButton
//      prop   Annotator.Config.Containers.$sideStatusMain
//      prop   Annotator.Config.Containers.$sideStatusSubmit
//      prop   Annotator.Config.Containers.$returnButton
//      prop   Annotator.Config.Containers.$sideStatusHR
//  prop   Annotator.activeEvent
//  method Annotator.initAnnotator()
//  method Annotator.resizeSidebar()
//  method Annotator.refreshContextList()
//  method Annotator.refreshActiveElements()
//  method Annotator.toggleContext(eventID, groundingID)
//  method Annotator.submitAnnotations()