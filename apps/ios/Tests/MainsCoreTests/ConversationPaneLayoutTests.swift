import Foundation
import Testing
@testable import MainsCore

@Suite struct ConversationPaneLayoutTests {
    @Test(arguments: [760.0, 900.0, 1200.0]) func aWideOpenSidebarKeepsTheWholeConversationInsideTheWindow(width: Double) {
        for open in [false, true] {
            for drag in [-400.0, -120.0, 0.0, 120.0, 400.0] {
                let plan = SidebarPanePlan.make(width: width, regular: true, pinned: false, open: open, drag: drag)
                #expect(plan.sidebarWidth == 320 && plan.contentWidth >= 440)
                #expect(plan.contentOffset + plan.contentWidth == CGFloat(width))
                #expect(!plan.blocksContent && plan.overlayProgress == 0)
            }
        }
    }

    @Test func phonesAndNarrowRegularWindowsKeepTheMainPaneInPlace() {
        for (width, regular) in [(390.0, false), (900.0, false), (740.0, true)] {
            let plan = SidebarPanePlan.make(width: width, regular: regular, pinned: false, open: true)
            #expect(plan.contentWidth == width && plan.contentOffset == 0)
            #expect(plan.blocksContent && !plan.isInline && plan.overlayProgress == 1)
            let dragging = SidebarPanePlan.make(width: width, regular: regular, pinned: false, open: false, drag: plan.sidebarWidth / 2)
            #expect(dragging.contentWidth == width && dragging.contentOffset == 0 && dragging.overlayProgress == 0.5)
        }
        let pinned = SidebarPanePlan.make(width: 900, regular: true, pinned: true, open: false)
        #expect(pinned.isInline && pinned.contentWidth == 580 && pinned.contentOffset == 320 && !pinned.blocksContent)
    }

    @Test func openingAndClosingAWideSidebarAdaptsRetainedReadersWithoutChangingFocusOrFollowing() {
        var companion = ConversationCompanionState(); companion.open()
        var viewport = TranscriptViewport()
        viewport.beginPage(); viewport.finishPage(latestConfirmed: false)
        for (open, expected) in [(false, ConversationPanePlan.Mode.sideBySide), (true, .stacked), (false, .sideBySide)] {
            let sidebar = SidebarPanePlan.make(width: 900, regular: true, pinned: false, open: open)
            let readers = ConversationPanePlan.make(size: CGSize(width: sidebar.contentWidth, height: 800), expanded: true, state: companion)
            #expect(readers.mode == expected && readers.showsConversation && readers.showsOutput)
            #expect(companion.isOpen && companion.focus == .output)
            #expect(viewport.update(TranscriptGeometry(offset: 600, content: 4000, frame: readers.conversation.height), hasNewer: true, hasOlder: true) == nil)
            #expect(!viewport.following && !viewport.paging)
        }
    }

    @Test @MainActor func companionOutputReadsSkipMissingFilesAndKeepOnlyOneDescriptorPage() async throws {
        let output = RunOutput(artifactId: 1, runId: "chat", name: "Report.pdf", mimeType: "application/pdf", byteSize: 10,
                               version: String(repeating: "a", count: 64), previewType: "pdf")
        var cursors: [Int] = []
        let page = try await RunOutputsPage.firstAvailable(runID: "chat", offset: 40) { cursor in
            cursors.append(cursor)
            return cursor < 120 ? RunOutputsPage(items: [], nextOffset: cursor + 40) : RunOutputsPage(items: [output], nextOffset: 160)
        }
        #expect(cursors == [40, 80, 120] && page.items.map(\.id) == [1] && page.nextOffset == 160)
    }

    @Test @MainActor func companionOutputReadsRejectForeignDuplicatesAndNonAdvancingCursors() async throws {
        let output = RunOutput(artifactId: 1, runId: "other-chat", name: "Private.pdf", mimeType: "application/pdf", byteSize: 10,
                               version: String(repeating: "a", count: 64), previewType: "pdf")
        for page in [RunOutputsPage(items: [output], nextOffset: nil), RunOutputsPage(items: [], nextOffset: 0)] {
            await #expect(throws: MainsError.self) { try await RunOutputsPage.firstAvailable(runID: "chat") { _ in page } }
        }
        await #expect(throws: MainsError.self) { try await RunOutputsPage.firstAvailable(runID: "other-chat") { _ in RunOutputsPage(items: [output, output], nextOffset: nil) } }
        var reads = 0
        await #expect(throws: MainsError.self) {
            try await RunOutputsPage.firstAvailable(runID: "chat") { cursor in reads += 1; return RunOutputsPage(items: [], nextOffset: cursor + 1) }
        }
        #expect(reads == 128)
    }

    @Test @MainActor func cancelledOutputDiscoveryCannotReturnALateDescriptor() async throws {
        var held: CheckedContinuation<RunOutputsPage, Never>?
        let read = Task {
            try await RunOutputsPage.firstAvailable(runID: "chat") { _ in await withCheckedContinuation { held = $0 } }
        }
        try await eventually { held != nil }
        read.cancel(); held?.resume(returning: RunOutputsPage(items: [], nextOffset: nil))
        await #expect(throws: CancellationError.self) { try await read.value }
    }

    @Test func automaticOpeningDoesNotStealFocusAndAnExplicitCloseSurvivesResizing() {
        var state = ConversationCompanionState()
        state.adapt(expanded: false, hasOutputs: true)
        #expect(!state.isOpen)
        state.adapt(expanded: true, hasOutputs: false)
        #expect(!state.isOpen)
        state.adapt(expanded: true, hasOutputs: true)
        #expect(state.isOpen && state.focus == .conversation)
        state.close()
        state.adapt(expanded: false, hasOutputs: true)
        state.adapt(expanded: true, hasOutputs: true)
        #expect(!state.isOpen && state.focus == .conversation)
    }

    @Test func foldingKeepsTheCompanionOpenAndShowsTheLastFocusedReader() {
        var state = ConversationCompanionState()
        state.open()
        let wide = ConversationPanePlan.make(size: CGSize(width: 900, height: 640), expanded: true, state: state)
        #expect(wide.mode == .sideBySide && wide.showsConversation && wide.showsOutput)
        state.adapt(expanded: false, hasOutputs: true)
        let narrow = ConversationPanePlan.make(size: CGSize(width: 390, height: 750), expanded: false, state: state)
        #expect(state.isOpen && narrow.mode == .output)
        state.focusConversation()
        let reading = ConversationPanePlan.make(size: CGSize(width: 390, height: 750), expanded: false, state: state)
        #expect(state.isOpen && reading.mode == .conversation)
        state.adapt(expanded: true, hasOutputs: true)
        #expect(ConversationPanePlan.make(size: CGSize(width: 900, height: 640), expanded: true, state: state).showsOutput)
    }

    @Test func outputsButtonSwitchesRetainedReadersAfterFoldingWithoutClosingTheFile() {
        var state = ConversationCompanionState()
        #expect(state.outputsAction(twoReaders: false) == .browse)
        #expect(state.outputsAction(twoReaders: true) == .open)
        state.open()
        #expect(state.outputsAction(twoReaders: true) == .close)
        for (size, expanded, accessible) in [
            (CGSize(width: 390, height: 750), false, false),
            (CGSize(width: 440, height: 800), true, false),
            (CGSize(width: 1000, height: 800), true, true),
        ] {
            let output = ConversationPanePlan.make(size: size, expanded: expanded, accessibilityText: accessible, state: state)
            let both = output.showsConversation && output.showsOutput
            #expect(!both && state.outputsAction(twoReaders: both) == .showConversation)
            state.focusConversation()
            let conversation = ConversationPanePlan.make(size: size, expanded: expanded, accessibilityText: accessible, state: state)
            #expect(conversation.mode == .conversation && state.outputsAction(twoReaders: both) == .showOutput)
            state.focusOutput()
            #expect(state.isOpen && state.focus == .output)
        }
        state.close()
        state.adapt(expanded: true, hasOutputs: true)
        #expect(!state.isOpen && state.outputsAction(twoReaders: false) == .browse)
    }

    @Test func aVeryShortWindowNeverOffersAnEmptySecondReader() {
        var state = ConversationCompanionState(); state.open()
        for height in [120.0, 240.0] {
            let size = CGSize(width: 620, height: height)
            let output = ConversationPanePlan.make(size: size, expanded: true, state: state)
            #expect(output.mode == .output && output.output.size == size)
            #expect(state.outputsAction(twoReaders: output.showsConversation && output.showsOutput) == .showConversation)
            state.focusConversation()
            let conversation = ConversationPanePlan.make(size: size, expanded: true, state: state)
            #expect(conversation.mode == .conversation && conversation.conversation.size == size)
            state.focusOutput()
        }
    }

    @Test func aBookFoldKeepsBothReadersAndTheirControlsClearOfTheReservedRegion() {
        var state = ConversationCompanionState(); state.open()
        let size = CGSize(width: 900, height: 640), fold = CGRect(x: 432, y: 0, width: 36, height: 640)
        let plan = ConversationPanePlan.make(size: size, expanded: true, state: state, divisions: [fold])
        #expect(plan.mode == .sideBySide)
        #expect(plan.conversation.maxX <= fold.minX && plan.output.minX >= fold.maxX)
        #expect(!plan.conversation.intersects(plan.output))
        #expect(plan.conversation.minY == 0 && plan.output.maxY == size.height)
        let rtl = ConversationPanePlan.make(size: size, expanded: true, rightToLeft: true, state: state, divisions: [fold])
        #expect(rtl.conversation == plan.output && rtl.output == plan.conversation)
    }

    @Test func aTabletopFoldPlacesOutputAboveTheConversationAndKeyboardChangesKeepThatOrder() {
        var state = ConversationCompanionState(); state.open()
        let fold = CGRect(x: 0, y: 400, width: 680, height: 24)
        for height in [900.0, 650.0] {
            let plan = ConversationPanePlan.make(size: CGSize(width: 680, height: height), expanded: true, state: state, divisions: [fold])
            #expect(plan.mode == .stacked)
            #expect(plan.output.maxY <= fold.minY && plan.conversation.minY >= fold.maxY)
            #expect(plan.conversation.maxY == height && !plan.conversation.intersects(plan.output))
        }
    }

    @Test func aKeyboardDoesNotTurnAnOpenPortraitWorkspaceIntoAnOutputOnlyScreen() {
        var state = ConversationCompanionState(); state.open(); state.focusConversation()
        for height in [900.0, 500.0, 320.0] {
            let plan = ConversationPanePlan.make(size: CGSize(width: 620, height: height), expanded: true, state: state)
            #expect(plan.mode == .stacked && plan.showsConversation)
            #expect(plan.conversation.height >= 240 && plan.conversation.maxY == height)
        }
    }

    @Test func accessibilityTextAndNarrowMultitaskingUseOneFocusedReader() {
        var state = ConversationCompanionState(); state.open()
        let accessible = ConversationPanePlan.make(size: CGSize(width: 1000, height: 800), expanded: true, accessibilityText: true, state: state)
        #expect(accessible.mode == .output && accessible.output.width == 1000)
        let narrow = ConversationPanePlan.make(size: CGSize(width: 440, height: 800), expanded: true, state: state)
        #expect(narrow.mode == .output && !narrow.showsConversation)
        state.focusConversation()
        let fold = CGRect(x: 360, y: 0, width: 24, height: 700)
        let reading = ConversationPanePlan.make(size: CGSize(width: 700, height: 700), expanded: true, accessibilityText: true, state: state, divisions: [fold])
        #expect(reading.mode == .conversation && reading.conversation.minX >= fold.maxX)
    }

    @Test func resizingAPausedHistoricalTranscriptDoesNotPageOrResumeFollowing() {
        var viewport = TranscriptViewport()
        viewport.beginPage(); viewport.finishPage(latestConfirmed: false)
        var state = ConversationCompanionState(); state.adapt(expanded: true, hasOutputs: true)
        for (width, height, content) in [(900.0, 640.0, 4000.0), (620, 900, 6200), (390, 750, 9000), (900, 400, 4000)] {
            let plan = ConversationPanePlan.make(size: CGSize(width: width, height: height), expanded: width > 500, state: state)
            #expect(viewport.update(TranscriptGeometry(offset: 600, content: content, frame: plan.conversation.height), hasNewer: true, hasOlder: true) == nil)
            #expect(!viewport.following && !viewport.paging && !viewport.interacting)
        }
    }

    @Test func hidingARetainedChatEndsItsGestureWithoutResumingOrPaging() {
        var viewport = TranscriptViewport()
        viewport.beginPage(); viewport.finishPage(latestConfirmed: false)
        _ = viewport.update(TranscriptGeometry(offset: 600, content: 4000, frame: 640), hasNewer: true, hasOlder: true)
        viewport.beginInteraction()
        _ = viewport.update(TranscriptGeometry(offset: 550, content: 4000, frame: 640), hasNewer: true, hasOlder: true)
        viewport.interruptInteraction()
        #expect(!viewport.interacting && !viewport.following)
        #expect(viewport.update(TranscriptGeometry(offset: 100, content: 7000, frame: 750), hasNewer: true, hasOlder: true) == nil)
        #expect(viewport.endInteraction(hasNewer: true, hasOlder: true) == nil)
        #expect(!viewport.following && !viewport.paging)
    }
}
