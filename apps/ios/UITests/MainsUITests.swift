import XCTest
import UIKit

/// Run alongside scripts/mock-backend.mjs. No AI provider or real workspace is contacted.
@MainActor
final class MainsUITests: XCTestCase {
    func testVoiceDefaultsToFocusAndSwitchesToConversationWithoutEndingOrUnmuting() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--voice-preview"]
        app.launch()
        let stage = app.descendants(matching: .any).matching(identifier: "voiceFocusStage").firstMatch
        XCTAssertTrue(stage.waitForExistence(timeout: 15))
        XCTAssertFalse(app.scrollViews["conversationTranscript"].isHittable)
        let orb = app.descendants(matching: .any).matching(identifier: "voiceOrb").firstMatch
        XCTAssertGreaterThan(orb.frame.width, 180)
        let focusedOrbWidth = orb.frame.width
        XCTAssertEqual(orb.frame.midX, app.frame.midX, accuracy: 4)
        attachScreenshot(app, name: "GPT Live – water focus")
        app.buttons["muteVoice"].tap()
        XCTAssertEqual(app.buttons["muteVoice"].label, "Unmute microphone")
        app.buttons["voiceDisplayOptions"].tap()
        app.buttons["Conversation"].tap()
        XCTAssertTrue(stage.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.scrollViews["conversationTranscript"].waitForExistence(timeout: 5))
        let compactOrb = app.descendants(matching: .any).matching(identifier: "voiceComposerOrb").firstMatch
        XCTAssertTrue(compactOrb.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(compactOrb.frame.width, 80)
        XCTAssertLessThan(compactOrb.frame.width, focusedOrbWidth)
        XCTAssertLessThan(compactOrb.frame.maxY, app.textViews["messageInput"].frame.minY)
        XCTAssertEqual(app.buttons["muteVoice"].label, "Unmute microphone")
        attachScreenshot(app, name: "GPT Live – water above composer")
        app.buttons["voiceDisplayOptions"].tap()
        app.buttons["Focus"].tap()
        XCTAssertTrue(stage.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["muteVoice"].label, "Unmute microphone")
        app.buttons["endVoice"].tap()
        XCTAssertTrue(stage.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.scrollViews["conversationTranscript"].exists)
    }

    func testWaterVoiceFocusSupportsLightAppearance() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--voice-preview", "--voice-preview-light"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "voiceFocusStage").firstMatch.waitForExistence(timeout: 15))
        attachScreenshot(app, name: "GPT Live – water in light appearance")
        app.buttons["endVoice"].tap()
    }

    func testWaterVoiceStaysStaticWithReduceMotion() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--voice-preview", "--voice-preview-reduced-motion"]
        app.launch()
        let orb = app.descendants(matching: .any).matching(identifier: "voiceOrb").firstMatch
        XCTAssertTrue(orb.waitForExistence(timeout: 15))
        func pixels() throws -> Data {
            let screenshot = try XCTUnwrap(app.screenshot().image.cgImage)
            let scale = CGFloat(screenshot.width) / app.frame.width
            let rect = CGRect(x: (orb.frame.minX - app.frame.minX) * scale, y: (orb.frame.minY - app.frame.minY) * scale,
                              width: orb.frame.width * scale, height: orb.frame.height * scale).integral
            return try XCTUnwrap(UIImage(cgImage: XCTUnwrap(screenshot.cropping(to: rect))).pngData())
        }
        let first = try pixels()
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(first, try pixels())
        app.buttons["endVoice"].tap()
    }

    func testCodexEmptyComposerOffersVoiceAndDisclosesMicrophoneSharing() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let mic = app.buttons["startVoice"]
        XCTAssertTrue(mic.waitForExistence(timeout: 10)); XCTAssertTrue(mic.isEnabled)
        let input = app.textViews["homeMessageInput"]
        input.tap(); input.typeText("Keep this written draft")
        XCTAssertTrue(app.buttons["startConversation"].exists)
        XCTAssertFalse(mic.exists)
        // Clear with keyboard input so the same editor remains mounted.
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Keep this written draft".count))
        XCTAssertTrue(mic.waitForExistence(timeout: 5)); mic.tap()
        XCTAssertTrue(app.staticTexts["Your microphone audio during the call"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["allowDataSharing"].label.contains("Allow & Start"))
        app.buttons["declineDataSharing"].tap()
        XCTAssertTrue(mic.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["endVoice"].exists)
        forgetFixture(app)
    }

    func testTranscriptPagesAutomaticallyAndKeepsReadingPositionDuringRefresh() async throws {
        try await assertAutomaticTranscriptPaging(code: "ios-test-paging")
    }

    func testTranscriptPagesAcrossDisjointMobileWindows() async throws {
        try await assertAutomaticTranscriptPaging(code: "ios-test-paging-disjoint")
    }

    private func assertAutomaticTranscriptPaging(code: String) async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: code)
        conversation.tap()
        let transcript = app.scrollViews["conversationTranscript"]
        XCTAssertTrue(transcript.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Load newer messages"].exists)
        func directions() async throws -> [String] {
            let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
            let requests = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
            return requests.compactMap { request in
                guard request["channel"] as? String == "runs:getHistory",
                      let input = (request["args"] as? [[String: Any]])?.first else { return nil }
                return input["direction"] as? String
            }
        }
        for _ in 0..<10 {
            transcript.swipeDown()
            if try await directions().filter({ $0 == "older" }).count >= 3 { break }
        }
        let olderCount = try await directions().filter { $0 == "older" }.count
        XCTAssertGreaterThanOrEqual(olderCount, 3)
        let latest = app.buttons["jumpToLatest"]
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        let anchor = try XCTUnwrap(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Earlier note")).allElementsBoundByIndex.first { $0.isHittable })
        let before = anchor.frame.minY
        let refreshes = try await directions().filter { $0 == "refresh" }.count
        var append = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/append-history")!)
        append.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: append)
        for _ in 0..<40 {
            if try await directions().filter({ $0 == "refresh" }).count > refreshes { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertEqual(anchor.frame.minY, before, accuracy: 8)
        XCTAssertFalse(app.staticTexts["The latest response arrived."].isHittable)
        for _ in 0..<14 {
            // The scroll view extends beneath the composer. Start in visible prose,
            // away from both its controls and the centered latest arrow.
            transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.65))
                .press(forDuration: 0.05, thenDragTo: transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.25)))
            if try await directions().contains("newer") { break }
        }
        let loadedNewer = try await directions().contains("newer")
        if !loadedNewer { print("PAGING FAILURE HIERARCHY\n" + app.debugDescription) }
        XCTAssertTrue(loadedNewer)
        if !latest.exists { transcript.swipeDown() }
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        latest.tap()
        XCTAssertTrue(app.staticTexts["The latest response arrived."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["The latest response arrived."].isHittable)
        XCTAssertFalse(app.buttons["Load newer messages"].exists)
        forgetFixture(app)
    }

    func testDemoLiveActivityTransitionsFromThinkingThroughToolsToFinished() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app); app.buttons["startDemo"].tap()
        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 10)); input.tap(); input.typeText("Review the sample workspace")
        app.buttons["startConversation"].tap()
        let consent = app.buttons["allowDataSharing"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5)); consent.tap()
        let activity = app.descendants(matching: .any).matching(identifier: "agentActivity").firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Working on your computer…"].exists)
        XCTAssertFalse(app.staticTexts["Responding…"].exists)
        let tool = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "toolCall-")).firstMatch
        XCTAssertTrue(tool.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Demo result"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["stopReply"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(activity.waitForNonExistence(timeout: 5))
    }

    func testMissingWorkspaceExplainsSendAndKeepsTheDraft() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["sidebarMode-developer"].tap()
        app.buttons["closeSidebar"].tap()
        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("Choose a workspace"))
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap(); input.typeText("Keep this request")
        let send = app.buttons["startConversation"]
        XCTAssertTrue(send.isEnabled); send.tap()
        XCTAssertTrue(app.staticTexts["Workspace required"].waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Keep this request")
        XCTAssertFalse(app.buttons["allowDataSharing"].exists)
        app.buttons["chooseRequiredWorkspace"].tap()
        let target = app.buttons["target-fixture-workspace"]
        XCTAssertTrue(target.waitForExistence(timeout: 5)); target.tap()
        XCTAssertEqual(input.value as? String, "Keep this request")
        send.tap()
        XCTAssertTrue(app.buttons["allowDataSharing"].waitForExistence(timeout: 5))
        app.buttons["allowDataSharing"].tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
    }

    func testDemoContextPickerKeepsKeyboardAndSendsSelections() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app); app.buttons["startDemo"].tap()
        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 10)); input.tap(); input.typeText("$demo-wr")
        let writing = app.buttons["context-skill-demo-writing"]
        XCTAssertTrue(writing.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["contextSection-Skills"].exists)
        XCTAssertTrue(writing.label.contains("User"))
        XCTAssertTrue(writing.label.contains("Make the sample response clear and concise."))
        writing.tap()
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Picking context must keep the composer keyboard.")
        XCTAssertEqual(input.value as? String, "Clear writing ")
        XCTAssertFalse(app.buttons["removeContext-demo-writing"].exists, "Context belongs inside the text, without a duplicate chip row.")
        input.typeText(XCUIKeyboardKey.delete.rawValue + XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(input.value as? String, "")
        input.typeText("/rev")
        let review = app.buttons["context-command-review"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["contextSection-Commands"].exists)
        XCTAssertTrue(review.label.contains("Command"))
        XCTAssertTrue(review.label.contains("Try a prepared workspace review."))
        review.tap()
        XCTAssertTrue((input.value as? String)?.contains("/review") == true)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        app.buttons["addAttachment"].tap()
        let plugins = app.buttons["choosePlugins"]
        XCTAssertTrue(plugins.waitForExistence(timeout: 5))
        let menu = app.descendants(matching: .any).matching(identifier: "attachmentMenu").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        XCTAssertEqual(menu.value as? String, "Open")
        plugins.tap()
        let planning = app.buttons["context-skill-demo-planning"]
        XCTAssertTrue(planning.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["contextSection-Plugins"].exists)
        XCTAssertTrue(planning.label.contains("Plugin"))
        XCTAssertTrue(planning.label.contains("Plan a small change using bundled sample guidance."))
        planning.tap()
        XCTAssertEqual(input.value as? String, "/review Planning ")
        input.typeText("Review this")
        XCTAssertEqual(input.value as? String, "/review Planning Review this")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        app.buttons["startConversation"].tap()
        let consent = app.buttons["allowDataSharing"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5)); consent.tap()
        XCTAssertTrue(app.staticTexts["Demo context received"].waitForExistence(timeout: 15))
        let message = app.textViews["messageInput"]
        XCTAssertTrue(message.waitForExistence(timeout: 5)); message.tap(); message.typeText("@demo-wr")
        XCTAssertTrue(writing.waitForExistence(timeout: 10)); writing.tap()
        app.buttons["sendMessage"].tap()
        XCTAssertEqual(message.value as? String, "")
        XCTAssertTrue(app.buttons["sendMessage"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["stopReply"].waitForNonExistence(timeout: 10))
        message.tap(); message.typeText("Show Markdown formatting")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["Markdown formatting"].waitForExistence(timeout: 15))
        let table = app.descendants(matching: .any).matching(identifier: "markdownTable").firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 10))
        XCTAssertTrue(table.staticTexts["Time"].exists)
        XCTAssertTrue(table.staticTexts["Google Play"].exists)
    }

    func testDemoAgentsOverlayDoesNotMoveTranscriptAndDetailsReturnToConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app); app.buttons["startDemo"].tap()
        openSidebar(app); app.buttons["Search"].tap()
        let search = app.textFields["globalSearchInput"]
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("Explore Mains")
        let tour = app.buttons["search-run-demo-native-tour"]
        XCTAssertTrue(tour.waitForExistence(timeout: 10)); tour.tap()
        let dock = app.buttons["subagentDock"]
        XCTAssertTrue(dock.waitForExistence(timeout: 10))
        let before = dock.frame.minY
        dock.tap()
        XCTAssertTrue(app.staticTexts["Completed"].waitForExistence(timeout: 5))
        XCTAssertEqual(dock.frame.minY, before, accuracy: 1)
        let security = app.buttons["subagent-9100000"]
        XCTAssertTrue(security.waitForExistence(timeout: 5)); security.tap()
        XCTAssertTrue(app.buttons["closeSubagent"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Security review"].waitForExistence(timeout: 5))
        app.buttons["closeSubagent"].tap()
        XCTAssertTrue(dock.waitForExistence(timeout: 5))
        XCTAssertEqual(dock.frame.minY, before, accuracy: 1)
        XCTAssertTrue(app.buttons["sendMessage"].exists)
    }

    func testDemoChangedFilesDiffPagingAndReturn() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app); app.buttons["startDemo"].tap()
        openSidebar(app); app.buttons["Search"].tap()
        let search = app.textFields["globalSearchInput"]
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("Explore Mains")
        let tour = app.buttons["search-run-demo-native-tour"]
        XCTAssertTrue(tour.waitForExistence(timeout: 10)); tour.tap()
        let swift = app.buttons["turnFile-9000001-Sources/Greeting.swift"]
        XCTAssertTrue(swift.waitForExistence(timeout: 10)); scrollTo(swift, in: app); swift.tap()
        XCTAssertTrue(app.scrollViews["fileDiffContent"].waitForExistence(timeout: 5))
        let added = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Added, line 2: ")).firstMatch
        XCTAssertTrue(added.waitForExistence(timeout: 10))
        app.buttons["closeFileDiff"].tap()
        let review = app.buttons["turnFile-9000001-Docs/Review.md"]
        XCTAssertTrue(review.waitForExistence(timeout: 5)); review.tap()
        let next = app.buttons["nextDiffPart"]
        XCTAssertTrue(next.waitForExistence(timeout: 10)); XCTAssertTrue(next.isEnabled); next.tap()
        XCTAssertTrue(app.staticTexts["Part 2"].waitForExistence(timeout: 10))
        let previous = app.buttons["previousDiffPart"]
        XCTAssertTrue(previous.isEnabled); previous.tap()
        XCTAssertTrue(app.staticTexts["Part 1"].waitForExistence(timeout: 10))
        app.buttons["closeFileDiff"].tap()
        XCTAssertFalse(app.buttons["demoChangesPrompt"].exists, "Back must return to the conversation, not home.")
        let expand = app.buttons["expandTurnChanges-9000001"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5)); scrollTo(expand, in: app); expand.tap()
        XCTAssertEqual(expand.value as? String, "Expanded")
        let rename = app.buttons["turnFile-9000001-Docs/guide.md"]
        scrollTo(rename, in: app); rename.tap()
        XCTAssertTrue(app.staticTexts["No line changes. The file was renamed or its metadata changed."].waitForExistence(timeout: 10))
        app.buttons["closeFileDiff"].tap()
        let binary = app.buttons["turnFile-9000001-Assets/sample.png"]
        scrollTo(binary, in: app); binary.tap()
        XCTAssertTrue(app.staticTexts["Binary file changes can be viewed on desktop."].waitForExistence(timeout: 10))
        app.buttons["closeFileDiff"].tap()
        XCTAssertTrue(binary.waitForExistence(timeout: 5), "Returning keeps the same conversation and expanded file list.")
        app.buttons["newConversation"].tap()
        openSidebar(app); app.buttons["openSettings"].tap()
        let exit = app.buttons["exitDemo"]; scrollTo(exit, in: app); exit.tap()
        XCTAssertTrue(app.buttons["startDemo"].waitForExistence(timeout: 5))
    }

    func testDemoApprovalAndQuestionCards() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app)
        app.buttons["startDemo"].tap()
        let sample = app.buttons["demoDecisionsPrompt"]
        XCTAssertTrue(sample.waitForExistence(timeout: 10)); sample.tap()
        app.buttons["startConversation"].tap()
        let consent = app.buttons["allowDataSharing"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5)); consent.tap()
        let allow = app.buttons["approvalAllow"]
        XCTAssertTrue(allow.waitForExistence(timeout: 15)); scrollTo(allow, in: app)
        let grant = app.buttons["allowForRun"]
        scrollTo(grant, in: app); XCTAssertTrue(grant.isHittable); grant.tap()
        allow.tap()

        let option = app.buttons["decisionOption-Review only"]
        XCTAssertTrue(option.waitForExistence(timeout: 10)); scrollTo(option, in: app); option.tap()
        app.buttons["questionSend"].tap()
        let submit = app.buttons["formSubmit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 10)); scrollTo(submit, in: app); submit.tap()
        XCTAssertTrue(app.staticTexts["formError-project"].waitForExistence(timeout: 5))
        let project = app.textFields["form-project"]
        let transcript = app.scrollViews["conversationTranscript"]
        for _ in 0..<5 where !project.isHittable { transcript.swipeDown() }
        XCTAssertTrue(project.isHittable); project.tap(); project.typeText("Native demo")
        XCTAssertEqual(project.value as? String, "Native demo")
        let done = app.buttons["dismissDecisionKeyboard"]
        XCTAssertTrue(done.waitForExistence(timeout: 5)); done.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        scrollTo(submit, in: app); submit.tap()
        let link = app.buttons["linkAccept"]
        XCTAssertTrue(link.waitForExistence(timeout: 10)); scrollTo(link, in: app); link.tap()
        XCTAssertTrue(app.buttons["acceptDemoLink"].waitForExistence(timeout: 5)); app.buttons["acceptDemoLink"].tap()

        let next = app.buttons["asyncNext"]
        XCTAssertTrue(next.waitForExistence(timeout: 10))
        let focus = app.buttons["decisionOption-Functionality"]
        scrollTo(focus, in: app); focus.tap(); next.tap()
        let detail = app.textFields["Your answer"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5)); detail.tap(); detail.typeText("Keep it native")
        scrollTo(next, in: app); next.tap()
        XCTAssertTrue(next.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Demo result"].waitForExistence(timeout: 15))
        app.buttons["newConversation"].tap()
        openSidebar(app); app.buttons["openSettings"].tap()
        let exit = app.buttons["exitDemo"]
        scrollTo(exit, in: app); exit.tap()
        XCTAssertTrue(app.buttons["startDemo"].waitForExistence(timeout: 5))
    }

    /// Runs entirely on-device; no mock server or external service is required.
    func testDemoModeEntryReplayMediaAndExit() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app)
        app.buttons["scanPairingCode"].tap()
        let demo = app.buttons["startDemoFromPairing"]
        XCTAssertTrue(demo.waitForExistence(timeout: 5)); demo.tap()
        let status = app.buttons["connectionPill"]
        XCTAssertTrue(status.waitForExistence(timeout: 10)); XCTAssertTrue(status.label.contains("Demo"))
        XCTAssertTrue(app.buttons["chooseTarget"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("mains"))

        app.terminate(); app.launch()
        XCTAssertTrue(status.waitForExistence(timeout: 10)); XCTAssertTrue(status.label.contains("Demo"))
        openSidebar(app); app.buttons["Search"].tap()
        let search = app.textFields["globalSearchInput"]
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("Explore Mains")
        let tour = app.buttons["search-run-demo-native-tour"]
        XCTAssertTrue(tour.waitForExistence(timeout: 10)); tour.tap()
        let pdf = app.buttons["transcriptMedia-output:-9001"]
        XCTAssertTrue(pdf.waitForExistence(timeout: 10))
        pdf.tap()
        XCTAssertTrue(app.otherElements["outputPreview"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["shareOutput"].exists)
        app.buttons["Close preview"].tap()
        let image = app.buttons["transcriptImage-output:9000003"]
        XCTAssertTrue(image.waitForExistence(timeout: 5)); image.tap()
        XCTAssertTrue(app.otherElements["outputPreview"].waitForExistence(timeout: 10))
        app.buttons["Close preview"].tap()

        let input = app.textViews["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap(); input.typeText("Review this demo workspace")
        app.buttons["sendMessage"].tap()
        let allow = app.buttons["allowDataSharing"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5)); XCTAssertEqual(allow.label, "Continue Demo"); allow.tap()
        XCTAssertTrue(app.staticTexts["Demo result"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["stopReply"].waitForNonExistence(timeout: 15))
        app.buttons["newConversation"].tap()
        XCTAssertTrue(app.buttons["demoSuggestedPrompt"].waitForExistence(timeout: 10))
        openSidebar(app); app.buttons["openSettings"].tap()
        let exit = app.buttons["exitDemo"]
        scrollTo(exit, in: app); exit.tap()
        XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))
        XCTAssertFalse(status.exists)
        app.buttons["startDemo"].tap() // Also available directly on the unpaired home.
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        openSidebar(app); app.buttons["openSettings"].tap()
        scrollTo(exit, in: app); exit.tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))
        XCTAssertFalse(status.exists)
    }

    func testUnpairedHomeAndInlinePairing() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        prepareUnpaired(app)
        XCTAssertTrue(app.staticTexts["No computer paired"].exists)
        XCTAssertFalse(app.buttons["connectionPill"].exists)
        openSidebar(app)
        app.buttons["closeSidebar"].tap()
        XCTAssertTrue(app.buttons["closeSidebar"].waitForNonExistence(timeout: 5))
        app.buttons["scanPairingCode"].tap()
        XCTAssertTrue(app.buttons["closePairing"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["closePairing"].tap()
        XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))

        app.buttons["scanPairingCode"].tap()
        let field = app.textFields["pairingLink"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText("not-a-pairing-link")
        app.buttons["reviewConnection"].tap()
        XCTAssertTrue(app.staticTexts["pairingError"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["confirmPairing"].exists)
        app.buttons["retryPairing"].tap()
        XCTAssertTrue(app.buttons["reviewConnection"].exists)
        app.buttons["closePairing"].tap()

        app.buttons["scanPairingCode"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText(fixtureLink("ios-test"))
        app.buttons["reviewConnection"].tap()
        let confirm = app.buttons["confirmPairing"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(field.exists, "Computer review stays in the pairing screen.")
        XCTAssertTrue(app.staticTexts["CODE DETECTED"].exists)
        XCTAssertTrue(app.staticTexts["Test Mac"].exists)
        app.buttons["retryPairing"].tap()
        XCTAssertFalse(confirm.exists)
        app.buttons["reviewConnection"].tap()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        XCTAssertTrue(app.buttons["openSidebar"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["No computer paired"].exists)
        forgetFixture(app)
    }

    func testConversationToolDetailsAndMediaPreviews() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test-media")
        conversation.tap()
        let transcript = app.scrollViews["conversationTranscript"]
        XCTAssertTrue(transcript.waitForExistence(timeout: 10))
        func revealEarlier(_ element: XCUIElement) {
            for _ in 0..<8 {
                if element.isHittable { break }
                transcript.swipeDown()
            }
            XCTAssertTrue(element.isHittable)
        }
        let document = app.buttons["transcriptMedia-output:505"]
        XCTAssertTrue(document.waitForExistence(timeout: 10))
        if !document.isHittable { transcript.swipeUp() }
        document.tap()
        XCTAssertTrue(app.otherElements["outputPreview"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["shareOutput"].exists)
        app.buttons["Close preview"].tap()

        let image = app.buttons["transcriptImage-output:504"]
        revealEarlier(image)
        image.tap()
        XCTAssertTrue(app.otherElements["outputPreview"].waitForExistence(timeout: 10))
        app.buttons["Close preview"].tap()

        let execution = app.buttons["executionDetails-artifact:2"]
        revealEarlier(execution); execution.tap()
        let block = app.buttons["toolBlock-7"]
        revealEarlier(block); block.tap()
        let call = app.buttons["toolCall-7"]
        XCTAssertTrue(call.label.contains("Ran"))
        XCTAssertTrue(call.label.contains("npm test"))
        revealEarlier(call); call.tap()
        let output = app.buttons["toolFullOutput-7"]
        if !output.isHittable { transcript.swipeUp() }
        XCTAssertTrue(output.isHittable); output.tap()
        XCTAssertTrue(app.staticTexts["Full tool output"].waitForExistence(timeout: 10))
        app.buttons["Done"].tap()
        forgetFixture(app)
    }

    func testAttachmentPanelsReturnToTheirMenuAndCloseRepeatedly() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let launcher = app.buttons["addAttachment"]
        let origin = launcher.frame
        launcher.tap()
        let menu = app.descendants(matching: .any).matching(identifier: "attachmentMenu").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        func menuBounds() -> CGRect { app.buttons["Camera"].frame.union(app.buttons["choosePlugins"].frame) }
        let menuFrame = menuBounds()
        XCTAssertLessThanOrEqual(menuFrame.maxY, origin.maxY + 16)
        XCTAssertGreaterThan(menuFrame.maxY, origin.maxY - 32)

        for label in ["Photos", "Camera", "Photos"] {
            app.buttons[label].tap()
            let id = label == "Photos" ? "attachmentPhotosPanel" : "attachmentCameraPanel"
            let panel = app.descendants(matching: .any).matching(identifier: id).firstMatch
            XCTAssertTrue(panel.waitForExistence(timeout: 5))
            let viewport = label == "Photos" ? app.scrollViews["attachmentPhotoGrid"]
                : app.descendants(matching: .any).matching(identifier: "attachmentCameraPreview").firstMatch
            XCTAssertTrue(viewport.waitForExistence(timeout: 5))
            XCTAssertGreaterThan(viewport.frame.height, menuFrame.height + 100)
            XCTAssertLessThan(viewport.frame.height, app.frame.height * 0.82)
            app.buttons["attachmentPanelBack"].tap()
            XCTAssertTrue(menu.waitForExistence(timeout: 5))
            XCTAssertEqual(menuBounds().minX, menuFrame.minX, accuracy: 3)
            XCTAssertEqual(menuBounds().maxY, menuFrame.maxY, accuracy: 3)
        }
        app.buttons["Photos"].tap()
        app.buttons["closeAttachmentPanel"].tap()
        XCTAssertTrue(menu.waitForNonExistence(timeout: 5))
        XCTAssertTrue(launcher.isHittable)
        launcher.tap(); app.buttons["Camera"].tap(); app.buttons["closeAttachmentPanel"].tap()
        XCTAssertTrue(menu.waitForNonExistence(timeout: 5))
        XCTAssertTrue(launcher.isHittable)
        openSidebar(app); app.buttons["conversation-fixture-run"].tap()
        XCTAssertTrue(app.textViews["messageInput"].waitForExistence(timeout: 5))
        launcher.tap(); app.buttons["Photos"].tap()
        app.buttons["attachmentPanelBack"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        app.buttons["Camera"].tap(); app.buttons["closeAttachmentPanel"].tap()
        XCTAssertTrue(menu.waitForNonExistence(timeout: 5))
        forgetFixture(app)
    }

    func testAttachmentMenuKeepsKeyboardAndDraftInHomeAndConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        func checkMenu(inputID: String, text: String) {
            let input = app.textViews[inputID]
            XCTAssertTrue(input.waitForExistence(timeout: 5))
            input.tap(); input.typeText(text)
            assertKeyboardVisible(app)
            let keyboardFrame = app.keyboards.firstMatch.frame
            for _ in 0..<2 {
                app.buttons["addAttachment"].tap()
                let menu = app.descendants(matching: .any).matching(identifier: "attachmentMenu").firstMatch
                let opened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Open"), object: menu)
                XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 5), .completed)
                assertKeyboardVisible(app)
                XCTAssertEqual(app.keyboards.firstMatch.frame.minY, keyboardFrame.minY, accuracy: 3)
                XCTAssertTrue(app.buttons["Camera"].isHittable)
                XCTAssertTrue(app.buttons["choosePlugins"].isHittable)
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.2)).tap()
                XCTAssertTrue(menu.waitForNonExistence(timeout: 5))
                assertKeyboardVisible(app)
                XCTAssertEqual(input.value as? String, text)
            }
            input.typeText(" and keep typing")
            XCTAssertEqual(input.value as? String, text + " and keep typing")
        }
        checkMenu(inputID: "homeMessageInput", text: "Keep my home draft")
        openSidebar(app); conversation.tap()
        checkMenu(inputID: "messageInput", text: "Keep my conversation draft")
        forgetFixture(app)
    }

    func testAttachmentPhotosStayUniformAndSendFromTheDraft() async throws {
        // Seed only the dedicated QA simulator with scripts' temporary coloured photo fixtures.
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let input = app.textViews["homeMessageInput"]
        input.tap(); input.typeText("Draft with photos")
        app.buttons["addAttachment"].tap(); app.buttons["Photos"].tap()
        let panel = app.descendants(matching: .any).matching(identifier: "attachmentPhotosPanel").firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertLessThan(app.scrollViews["attachmentPhotoGrid"].frame.height, app.frame.height * 0.82, "Photos uses a partial-height panel.")
        let tiles = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library-photo-"))
        XCTAssertTrue(tiles.element(boundBy: 4).waitForExistence(timeout: 5))
        for (order, index) in [0, 1, 3, 4].enumerated() {
            let tile = tiles.element(boundBy: index)
            tile.tap()
            XCTAssertEqual(tile.value as? String, "Selected \(order + 1)", "Photo selection must respond to a tap. Frame: \(tile.frame)")
        }
        let add = app.buttons["addSelectedPhotos"]
        XCTAssertTrue(add.label.contains("Add 4 photos")); add.tap()
        XCTAssertTrue(add.waitForNonExistence(timeout: 10))
        XCTAssertEqual(input.value as? String, "Draft with photos")

        let previews = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "attachment-photo-"))
        XCTAssertEqual(previews.count, 4)
        for preview in previews.allElementsBoundByIndex {
            XCTAssertEqual(preview.frame.width, 104, accuracy: 1)
            XCTAssertEqual(preview.frame.height, 104, accuracy: 1)
        }
        app.scrollViews["attachmentPhotos"].swipeLeft()
        app.buttons["Remove Photo-4.jpg"].tap()
        XCTAssertEqual(previews.count, 3)
        app.buttons["startConversation"].tap()
        let allow = app.buttons["allowDataSharing"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5)); allow.tap()
        XCTAssertTrue(app.textViews["messageInput"].waitForExistence(timeout: 10))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let execute = try XCTUnwrap(calls.last { $0["channel"] as? String == "runs:execute" })
        let payload = try XCTUnwrap((execute["args"] as? [[String: Any]])?.first)
        let attachments = try XCTUnwrap(payload["attachments"] as? [[String: Any]])
        XCTAssertEqual(attachments.count, 3)
        XCTAssertEqual(attachments.compactMap { $0["name"] as? String }, ["Photo-1.jpg", "Photo-2.jpg", "Photo-3.jpg"])
        XCTAssertTrue(attachments.allSatisfy { $0["type"] as? String == "image" && $0["mimeType"] as? String == "image/jpeg" })

        app.buttons["addAttachment"].tap(); app.buttons["Camera"].tap()
        let camera = app.descendants(matching: .any).matching(identifier: "attachmentCameraPanel").firstMatch
        XCTAssertTrue(camera.waitForExistence(timeout: 5))
        XCTAssertLessThan(app.descendants(matching: .any).matching(identifier: "attachmentCameraPreview").firstMatch.frame.height, app.frame.height * 0.82, "Camera uses the same partial-height panel.")
        app.buttons["attachmentPanelBack"].tap(); app.buttons["Photos"].tap()
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        app.buttons["closeAttachmentPanel"].tap()
        forgetFixture(app)
    }

    func testSettingsAppearanceAndProviderPermissionReset() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test")
        conversation.tap()
        let input = app.textViews["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("Allow this fixture for the settings check")
        app.buttons["sendMessage"].tap()
        let allow = app.buttons["allowDataSharing"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5)); allow.tap()
        XCTAssertTrue(allow.waitForNonExistence(timeout: 5))

        app.navigationBars.buttons.element(boundBy: 0).tap()
        openSidebar(app); app.buttons["openSettings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Test Mac"].exists)
        let sync = app.buttons["syncNow"]
        XCTAssertTrue(sync.isEnabled); sync.tap()
        let copy = app.buttons["copyDiagnostics"]
        scrollTo(copy, in: app); copy.tap()
        let copied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Copied"), object: copy)
        XCTAssertEqual(XCTWaiter.wait(for: [copied], timeout: 3), .completed)
        let dark = app.buttons["appearance-dark"]
        scrollTo(dark, in: app); dark.tap()
        XCTAssertTrue(dark.isSelected)

        let sharing = app.buttons["aiDataSharing"]
        scrollTo(sharing, in: app); sharing.tap()
        let codex = app.buttons["consent-codex"]
        XCTAssertTrue(codex.waitForExistence(timeout: 5))
        XCTAssertTrue(codex.label.contains("Allowed"))
        codex.tap(); app.buttons["Revoke"].tap()
        let revoked = app.descendants(matching: .any).matching(identifier: "consent-codex").firstMatch
        XCTAssertTrue(revoked.label.contains("Ask before sending"))
        XCTAssertFalse(app.buttons["resetAIDataPermissions"].exists)

        app.terminate(); app.launch()
        openSidebar(app); app.buttons["openSettings"].tap()
        scrollTo(dark, in: app)
        XCTAssertTrue(dark.isSelected, "Appearance persists across app launches.")
        app.buttons["appearance-system"].tap()
        forgetFromSettings(app)
        XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 {
            if element.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }

    func testEffortFollowsKeyboardVisibilityAndCatalogueReturn() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        func closeEffort() {
            app.buttons["closeEffortOverlay"].tap()
            let returned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: app.buttons["chooseModel"])
            XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 5), .completed)
        }

        let input = app.textViews["homeMessageInput"]
        input.tap(); input.typeText("Keep this keyboard draft")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["chooseModel"].tap()
        assertEffortAtVisibleBottom(app)
        chooseModel("fixture-deep", in: app)
        assertEffortAtVisibleBottom(app)
        closeEffort()
        XCTAssertEqual(input.value as? String, "Keep this keyboard draft")
        app.buttons["chooseModel"].tap()
        assertEffortAtVisibleBottom(app)
        closeEffort()
        forgetFixture(app)
    }

    private func assertEffortAtVisibleBottom(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let slider = app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch
        XCTAssertTrue(slider.waitForExistence(timeout: 5), file: file, line: line)
        let keyboard = app.keyboards.firstMatch
        let positioned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let keyboardFrame = keyboard.exists ? keyboard.frame : .null
            let visible = keyboardFrame.intersection(app.frame)
            let bottom = !visible.isNull && visible.height > 0 ? visible.minY : app.frame.maxY
            let gap = bottom - slider.frame.maxY
            return gap >= 8 && gap <= 180
        }, object: slider)
        XCTAssertEqual(XCTWaiter.wait(for: [positioned], timeout: 5), .completed,
                       "Effort must follow the visible bottom. Slider: \(slider.frame); keyboard: \(keyboard.exists ? keyboard.frame : .zero)", file: file, line: line)
        XCTAssertTrue(slider.isHittable, file: file, line: line)
    }

    func testComposerControlsStayAboveKeyboard() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let home = app.textViews["homeMessageInput"]
        home.tap(); home.typeText("A short keyboard draft")
        assertComposerAboveKeyboard(app, sendID: "startConversation")
        home.typeText("\nAnother line\nA third line")
        assertComposerAboveKeyboard(app, sendID: "startConversation")
        openSidebar(app); conversation.tap()
        let input = app.textViews["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("A conversation keyboard draft")
        assertComposerAboveKeyboard(app, sendID: "sendMessage")
        input.typeText("\nAnother line\nA third line")
        assertComposerAboveKeyboard(app, sendID: "sendMessage")
        forgetFixture(app)
    }

    private func assertComposerAboveKeyboard(_ app: XCUIApplication, sendID: String, file: StaticString = #filePath, line: UInt = #line) {
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), file: file, line: line)
        let keyboardTop = keyboard.frame.minY
        for id in ["addAttachment", "chooseModel", sendID] {
            let button = app.buttons[id]
            XCTAssertTrue(button.isHittable, file: file, line: line)
            XCTAssertLessThanOrEqual(button.frame.maxY, keyboardTop - 4, "\(id) must be fully above the keyboard", file: file, line: line)
        }
        let dismiss = app.buttons["dismissKeyboard"]
        if dismiss.exists {
            XCTAssertFalse(dismiss.frame.intersects(app.buttons[sendID].frame), "Keyboard dismissal must not cover Send", file: file, line: line)
        }
    }

    func testDataSharingDeclineKeepsDraftAndAllowSendsOnce() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test")
        conversation.tap()
        let input = app.textViews["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        let message = "Send only after explicit consent"
        input.tap(); input.typeText(message)

        func submissions() async throws -> Int {
            let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
            let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
            return calls.filter { ["runs:continue", "runs:execute"].contains($0["channel"] as? String ?? "") }.count
        }
        let before = try await submissions()
        for cancel in ["declineDataSharing", "closeDataSharing"] {
            app.buttons["sendMessage"].tap()
            XCTAssertTrue(app.buttons["allowDataSharing"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts["Share data with OpenAI?"].exists)
            XCTAssertTrue(app.staticTexts["Your message and chat history"].exists)
            XCTAssertTrue(app.staticTexts["Skills and instructions you attach"].exists)
            XCTAssertTrue(app.staticTexts["Files and tool results the agent uses"].exists)
            XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "providerPrivacy").firstMatch.exists)
            XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "mainsPrivacy").firstMatch.exists)
            app.buttons[cancel].tap()
            XCTAssertTrue(input.isHittable)
            XCTAssertEqual(input.value as? String, message)
            let count = try await submissions()
            XCTAssertEqual(count, before)
        }
        app.buttons["sendMessage"].tap()
        let allow = app.buttons["allowDataSharing"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5)); allow.tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
        let after = try await submissions()
        XCTAssertEqual(after, before + 1)
        forgetFixture(app)
    }

    func testEffortRepeatedOpeningUsesInteractiveControls() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test-home")
        app.buttons["space-fixture-claude"].tap()
        let input = app.textViews["homeMessageInput"]
        input.tap(); input.typeText("Keep this draft through repeated opening")
        let keyboard = app.keyboards.firstMatch
        let launcher = app.buttons["chooseModel"]
        var lastKeyboardFrame: CGRect?
        var lastLauncherFrame: CGRect?
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard keyboard.exists else { return false }
            let keyboardFrame = keyboard.frame
            let launcherFrame = launcher.frame
            defer { lastKeyboardFrame = keyboardFrame; lastLauncherFrame = launcherFrame }
            return keyboardFrame.intersects(app.frame) && keyboardFrame == lastKeyboardFrame && launcherFrame == lastLauncherFrame
        }, object: keyboard)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed)
        for id in ["fixture-deep", "fixture-balanced", "fixture-deep"] {
            let launcher = app.buttons["chooseModel"]
            XCTAssertTrue(launcher.isHittable)
            launcher.tap()
            let picker = app.buttons["selectModel"]
            XCTAssertTrue(picker.waitForExistence(timeout: 5))
            XCTAssertTrue(picker.isHittable)
            let slider = app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch
            XCTAssertTrue(slider.isHittable)
            chooseModel(id, in: app)
            let close = app.buttons["closeEffortOverlay"]
            XCTAssertTrue(close.isHittable); close.tap()
            let returned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: launcher)
            XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 5), .completed)
            XCTAssertFalse(picker.exists)
            XCTAssertEqual(input.value as? String, "Keep this draft through repeated opening")
        }
        forgetFixture(app)
    }

    func testEffortKeepsKeyboardDraftAndClosesOnBackdrop() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let input = app.textViews["homeMessageInput"]
        input.tap(); input.typeText("Keep my keyboard draft")
        assertKeyboardVisible(app)
        app.buttons["chooseModel"].tap()
        let slider = app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch
        XCTAssertTrue(slider.waitForExistence(timeout: 5))
        assertKeyboardVisible(app)
        assertEffortAtVisibleBottom(app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertTrue(app.buttons["chooseModel"].waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Keep my keyboard draft")
        assertKeyboardVisible(app)
        openSidebar(app); conversation.tap()
        let message = app.textViews["messageInput"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap(); message.typeText("Keep my conversation keyboard")
        assertKeyboardVisible(app)
        app.buttons["chooseModel"].tap()
        XCTAssertTrue(slider.waitForExistence(timeout: 5))
        assertKeyboardVisible(app)
        assertEffortAtVisibleBottom(app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: app.buttons["chooseModel"])
        XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 5), .completed)
        XCTAssertEqual(message.value as? String, "Keep my conversation keyboard")
        assertKeyboardVisible(app)
        forgetFixture(app)
    }

    private func assertKeyboardVisible(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let keyboard = app.keyboards.firstMatch
        var previous: CGRect?
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard keyboard.exists else { return false }
            let frame = keyboard.frame
            defer { previous = frame }
            return frame.height > 80 && app.frame.contains(frame) && previous == frame
        }, object: keyboard)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed, "The software keyboard should stay visible", file: file, line: line)
    }

    func testEffortControlsFollowModelAndKeepSavedValue() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test-home")
        app.buttons["space-fixture-claude"].tap()
        let draft = app.textViews["homeMessageInput"]
        draft.tap(); draft.typeText("Keep this draft")
        app.buttons["chooseModel"].tap()
        XCTAssertTrue(app.buttons["selectModel"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["model-fixture-balanced"].exists)
        attachScreenshot(app, name: "Native model – effort first")
        app.buttons["selectModel"].tap()
        XCTAssertTrue(app.buttons["model-fixture-thinking"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["For everyday tasks"].exists)
        XCTAssertTrue(app.staticTexts["For complex problems"].exists)
        attachScreenshot(app, name: "Native model – card catalogue")
        app.buttons["model-fixture-thinking"].tap()
        let thinking = app.switches["thinkingToggle"]
        XCTAssertTrue(thinking.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch.exists)
        thinking.tap(); XCTAssertEqual(thinking.value as? String, "1")
        app.buttons["selectModel"].tap()
        app.buttons["closeComposerSheet"].tap()
        XCTAssertTrue(thinking.waitForExistence(timeout: 5))
        XCTAssertEqual(thinking.value as? String, "1")
        thinking.tap(); XCTAssertEqual(thinking.value as? String, "0")
        chooseModel("fixture-single", in: app)
        XCTAssertEqual(thinking.value as? String, "0")
        thinking.tap(); XCTAssertEqual(thinking.value as? String, "1")
        attachScreenshot(app, name: "Native model – single effort switch")
        chooseModel("fixture-deep", in: app)
        selectEffort(at: 0, in: app)
        selectEffort(at: 1, in: app, drag: true)
        attachScreenshot(app, name: "Native model – stepped effort gradient")
        app.buttons["Close"].tap()
        XCTAssertEqual(draft.value as? String, "Keep this draft")
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Extra High"))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["chooseModel"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Extra High"))
        app.buttons["runOptions"].tap()
        XCTAssertTrue(app.buttons["permission-default"].isHittable)
        XCTAssertTrue(app.buttons["permission-dontAsk"].isHittable)
        attachScreenshot(app, name: "Native run options – compact permissions")
        app.buttons["Close"].tap()
        forgetFixture(app)
    }

    func testSearchChatsWorkspacesClearAndClose() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test-workspace")
        app.buttons["Search"].tap()
        let input = app.textFields["globalSearchInput"]
        func assertInputAboveKeyboard() {
            let positioned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard input.exists, app.keyboards.firstMatch.exists else { return false }
                let gap = app.keyboards.firstMatch.frame.minY - input.frame.maxY
                return gap >= -1 && gap < 80
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [positioned], timeout: 5), .completed)
        }
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        assertInputAboveKeyboard()
        XCTAssertTrue(app.staticTexts["Search chats and workspaces"].exists)
        input.typeText("No matching result")
        XCTAssertTrue(app.staticTexts["No results found"].waitForExistence(timeout: 5))
        app.buttons["clearGlobalSearch"].tap()
        XCTAssertTrue(app.staticTexts["Search chats and workspaces"].exists)
        input.typeText("m")
        XCTAssertTrue(app.buttons["search-run-workspace-third"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["mains · Code"].exists)
        let workspace = app.buttons["search-workspace-fixture-workspace"]
        XCTAssertTrue(workspace.exists)
        workspace.tap()
        XCTAssertTrue(app.textFields["workspaceSearch"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()

        openSidebar(app)
        app.buttons["Search"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("Homepage")
        app.buttons["search-run-workspace-third"].tap()
        XCTAssertTrue(app.staticTexts["Hello from this workspace."].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        openSidebar(app)
        app.buttons["Search"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        app.buttons["closeGlobalSearch"].tap()
        XCTAssertTrue(app.buttons["openSettings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["openSettings"].isHittable)
        XCTAssertTrue(app.buttons["closeSidebar"].exists)
        XCTAssertFalse(input.exists)
        app.buttons["Search"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        assertInputAboveKeyboard()
        app.buttons["closeGlobalSearch"].tap()
        XCTAssertTrue(app.buttons["openSettings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["openSettings"].isHittable)
        XCTAssertTrue(app.buttons["closeSidebar"].exists)
        XCTAssertFalse(input.exists)
        forgetFixture(app)
    }

    func testHomeConnectionRecoveryKeepsDraftAndOpensComputer() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("Keep this draft")
        let pill = app.buttons["connectionPill"]
        XCTAssertFalse(pill.exists)

        var hold = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/hold-snapshot")!)
        hold.httpMethod = "POST"; hold.httpBody = Data(#"{"durationMs":10000}"#.utf8)
        _ = try await URLSession.shared.data(for: hold)
        var offline = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/offline")!)
        offline.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: offline)
        XCTAssertTrue(pill.waitForExistence(timeout: 3))
        XCTAssertTrue(pill.label.contains("Test Mac: Reconnecting"))
        XCTAssertEqual(pill.frame.midX, app.frame.midX, accuracy: 8)
        XCTAssertEqual(input.value as? String, "Keep this draft")
        attachScreenshot(app, name: "Native home – reconnecting computer")
        pill.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Test Mac"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let syncing = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Syncing"), object: pill)
        let syncingResult = await XCTWaiter.fulfillment(of: [syncing], timeout: 10)
        XCTAssertEqual(syncingResult, .completed)
        attachScreenshot(app, name: "Native home – syncing computer")
        let recovered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: pill)
        let recoveredResult = await XCTWaiter.fulfillment(of: [recovered], timeout: 15)
        XCTAssertEqual(recoveredResult, .completed)
        XCTAssertEqual(input.value as? String, "Keep this draft")
        XCTAssertTrue(app.buttons["startConversation"].isEnabled)
        attachScreenshot(app, name: "Native home – live connection")
        forgetFixture(app)
    }

    func testWorkspaceListSearchOpenAndNewConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test-workspace")
        app.buttons["space-fixture-code"].tap()
        openSidebar(app)
        app.buttons["workspace-fixture-workspace"].tap()
        let input = app.textFields["workspaceSearch"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let header = app.descendants(matching: .any).matching(identifier: "workspaceTitle").firstMatch
        XCTAssertTrue(header.exists)
        XCTAssertEqual(header.frame.midX, app.frame.midX, accuracy: 8)
        XCTAssertTrue(app.buttons["conversation-workspace-first"].exists)
        XCTAssertTrue(app.buttons["conversation-workspace-second"].exists)
        XCTAssertTrue(app.buttons["conversation-workspace-third"].exists)
        XCTAssertFalse(app.staticTexts["Conversations"].exists)
        attachScreenshot(app, name: "Native workspace – conversation list")
        input.tap(); input.typeText("Homepage")
        XCTAssertTrue(app.buttons["conversation-workspace-third"].exists)
        XCTAssertFalse(app.buttons["conversation-workspace-first"].exists)
        app.buttons["closeWorkspaceSearch"].tap()
        input.tap(); input.typeText("No matching title")
        XCTAssertTrue(app.staticTexts["No runs match."].exists)
        app.buttons["closeWorkspaceSearch"].tap()
        app.buttons["conversation-workspace-first"].tap()
        XCTAssertTrue(app.staticTexts["Hello from this workspace."].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        app.buttons["newConversation"].tap()
        XCTAssertTrue(app.textViews["homeMessageInput"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("mains"))
        openSidebar(app)
        XCTAssertTrue(app.buttons["sidebarMode-developer"].isSelected)
        app.buttons["closeSidebar"].tap()
        forgetFixture(app)
    }

    func testConversationReferenceLayoutSettingsAndOutputs() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test-design", search: true)
        conversation.tap()
        let transcript = app.scrollViews["conversationTranscript"]
        XCTAssertTrue(transcript.waitForExistence(timeout: 10))
        transcript.swipeDown(); transcript.swipeDown()
        let details = app.buttons["executionDetails-artifact:2"]
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        XCTAssertTrue(details.label.contains("1 message · 1 tool call"))
        attachScreenshot(app, name: "Native conversation – reference layout")
        details.tap()
        XCTAssertTrue(app.staticTexts["Kaynağı inceleyip temel yaklaşımı çıkarıyorum."].exists)
        details.tap()
        XCTAssertFalse(app.staticTexts["Kaynağı inceleyip temel yaklaşımı çıkarıyorum."].exists)

        let readingPosition = details.frame.minY
        app.buttons["chooseModel"].tap()
        chooseModel("fixture-deep", in: app)
        selectEffort(at: 1, in: app, drag: true)
        attachScreenshot(app, name: "Native conversation – compact model and effort")
        app.buttons["Close"].tap()
        XCTAssertTrue(details.exists)
        XCTAssertEqual(details.frame.minY, readingPosition, accuracy: 8)
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Deep Thinker"))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Extra High"))
        app.buttons["runOptions"].tap()
        let readOnly = app.buttons["permission-read-only"]
        XCTAssertTrue(readOnly.waitForExistence(timeout: 5)); readOnly.tap()
        app.buttons["Close"].tap()

        app.buttons["conversationOutputs"].tap()
        let output = app.buttons["output-503"]
        XCTAssertTrue(output.waitForExistence(timeout: 10)); output.tap()
        XCTAssertTrue(app.buttons["shareOutput"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Article summary"].waitForExistence(timeout: 10))
        attachScreenshot(app, name: "Native conversation – output preview")
        app.buttons["Close preview"].tap(); app.buttons["Close"].tap()
        app.buttons["conversationOptions"].tap(); app.buttons["Sync now"].tap()
        let input = app.textViews["messageInput"]
        input.tap(); input.typeText("Use the conversation’s saved settings")
        app.buttons["sendMessage"].tap()
        if app.buttons["allowDataSharing"].waitForExistence(timeout: 3) { app.buttons["allowDataSharing"].tap() }
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let call = try XCTUnwrap(calls.last { $0["channel"] as? String == "runs:continue" })
        let payload = try XCTUnwrap((call["args"] as? [[String: Any]])?.first)
        let settings = try XCTUnwrap(payload["conversationSettings"] as? [String: Any])
        let config = try XCTUnwrap(settings["config"] as? [String: Any])
        XCTAssertEqual(settings["model"] as? String, "fixture-deep")
        XCTAssertEqual(config["modelReasoningEffort"] as? String, "xhigh")
        XCTAssertEqual(config["sandboxMode"] as? String, "read-only")
        app.buttons["newConversation"].tap()
        XCTAssertTrue(app.textViews["homeMessageInput"].waitForExistence(timeout: 5))
        openSidebar(app)
        XCTAssertTrue(app.buttons["sidebarMode-chat"].isSelected)
        app.buttons["closeSidebar"].tap()
        forgetFixture(app)
    }

    func testHomeSidebarModesAndConfiguredConversation() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        _ = pairFixture(app, code: "ios-test-home")
        XCTAssertTrue(app.staticTexts["Projects"].exists)
        attachScreenshot(app, name: "Native sidebar – projects")
        app.buttons["space-fixture-claude"].tap()
        XCTAssertTrue(app.textViews["homeMessageInput"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["modeSwitcher"].exists)
        XCTAssertFalse(app.buttons["startConversation"].isEnabled)
        openSidebar(app)
        XCTAssertTrue(app.buttons["sidebarMode-developer"].isSelected)
        XCTAssertTrue(app.staticTexts["Workspaces"].exists)
        await chooseSidebarMode("work", in: app)
        XCTAssertTrue(app.staticTexts["Projects"].exists)
        XCTAssertTrue(app.buttons["conversation-fixture-work"].exists)
        XCTAssertFalse(app.buttons["conversation-fixture-chat"].exists)
        XCTAssertFalse(app.staticTexts["Workspaces"].exists)
        attachScreenshot(app, name: "Native sidebar – Work tabs")
        app.buttons["collection-fixture-kitchen"].tap()
        app.buttons["collection-fixture-kitchen"].tap()
        app.buttons["closeSidebar"].tap()
        app.buttons["chooseTarget"].tap()
        attachScreenshot(app, name: "Native project – compact selection")
        app.buttons["target-fixture-kitchen"].tap()
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("Kitchen Notes"))
        attachScreenshot(app, name: "Native project – icon color target")

        openSidebar(app)
        await chooseSidebarMode("chat", in: app)
        XCTAssertTrue(app.buttons["conversation-fixture-chat"].exists)
        XCTAssertFalse(app.buttons["conversation-fixture-work"].exists)
        attachScreenshot(app, name: "Native sidebar – Chat tabs")
        app.buttons["closeSidebar"].tap()
        app.buttons["runOptions"].tap()
        XCTAssertFalse(app.buttons["permission-default"].exists)
        XCTAssertTrue(app.switches["Fast mode"].exists)
        app.buttons["Close"].tap()

        openSidebar(app)
        await chooseSidebarMode("developer", in: app)
        XCTAssertTrue(app.staticTexts["Workspaces"].exists)
        XCTAssertFalse(app.staticTexts["Projects"].exists)
        XCTAssertTrue(app.staticTexts["main"].exists)
        attachScreenshot(app, name: "Native sidebar – Code tabs")
        app.buttons["workspace-fixture-workspace"].tap()
        XCTAssertTrue(app.buttons["newConversation"].waitForExistence(timeout: 5))
        app.buttons["newConversation"].tap()
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("mains"))
        app.buttons["chooseTarget"].tap()
        attachScreenshot(app, name: "Native workspace – compact selection")
        app.buttons["target-fixture-workspace"].tap()

        app.buttons["chooseModel"].tap()
        chooseModel("fixture-deep", in: app)
        attachScreenshot(app, name: "Native model selection")
        selectEffort(at: 2.0 / 3, in: app)
        attachScreenshot(app, name: "Native effort selection")
        app.buttons["Close"].tap()
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Deep Thinker"))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("High"))
        app.buttons["runOptions"].tap()
        app.buttons["permission-plan"].tap()
        attachScreenshot(app, name: "Native run options")
        app.buttons["Close"].tap()

        let input = app.textViews["homeMessageInput"]
        input.tap(); input.typeText("Build from the native composer")
        app.buttons["startConversation"].tap()
        if app.buttons["allowDataSharing"].waitForExistence(timeout: 3) { app.buttons["allowDataSharing"].tap() }
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let call = try XCTUnwrap(calls.last { $0["channel"] as? String == "runs:execute" })
        let args = try XCTUnwrap(call["args"] as? [[String: Any]])
        let payload = try XCTUnwrap(args.first)
        XCTAssertEqual(payload["spaceId"] as? String, "fixture-claude")
        XCTAssertEqual(payload["workspaceId"] as? String, "fixture-workspace")
        XCTAssertNil(payload["collectionId"])
        XCTAssertEqual(payload["model"] as? String, "fixture-deep")
        let settings = try XCTUnwrap(payload["conversationSettings"] as? [String: Any])
        let config = try XCTUnwrap(settings["config"] as? [String: Any])
        XCTAssertEqual(config["effortLevel"] as? String, "high")
        XCTAssertEqual(config["permissionMode"] as? String, "plan")

        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["chooseTarget"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("mains"))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Deep Thinker"))
        attachScreenshot(app, name: "Native home – saved configuration")
        openSidebar(app)
        XCTAssertTrue(app.buttons["sidebarMode-developer"].isSelected)
        app.buttons["space-fixture-copilot"].tap()
        openSidebar(app)
        XCTAssertTrue(app.buttons["sidebarMode-developer"].isSelected)
        XCTAssertFalse(app.buttons["sidebarMode-work"].exists)
        XCTAssertFalse(app.buttons["sidebarMode-chat"].exists)
        app.buttons["space-fixture-claude"].tap()
        openSidebar(app)
        app.buttons["Search"].tap()
        let search = app.textFields["globalSearchInput"]
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("Native iOS")
        app.buttons["search-run-fixture-run"].tap()
        XCTAssertTrue(app.staticTexts["Hello from the computer."].waitForExistence(timeout: 10))
        forgetFixture(app)
    }

    func testChatDraftStopReadingAndRecovery() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test-chat")
        conversation.tap()
        let message = app.textViews["messageInput"]
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        message.tap(); message.typeText("Refuse this message")
        app.buttons["sendMessage"].tap()
        let consent = app.buttons["allowDataSharing"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        XCTAssertTrue(app.staticTexts["Couldn't send"].waitForExistence(timeout: 10))
        XCTAssertEqual(message.value as? String, "Refuse this message")

        message.tap()
        message.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Refuse this message".count))
        message.typeText("Take your time")
        app.buttons["sendMessage"].tap()
        let stop = app.buttons["stopReply"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        message.tap(); message.typeText("My next thought stays here")
        let transcript = app.scrollViews["conversationTranscript"]
        transcript.swipeDown()
        let latest = app.buttons["jumpToLatest"]
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        let anchor = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Earlier note")).allElementsBoundByIndex.first { $0.isHittable }
        XCTAssertNotNil(anchor)
        let before = anchor?.frame.minY
        stop.tap()
        let stopped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: stop)
        let stoppedResult = await XCTWaiter.fulfillment(of: [stopped], timeout: 10)
        XCTAssertEqual(stoppedResult, .completed)
        XCTAssertTrue(latest.isHittable)
        if let before, let anchor { XCTAssertEqual(anchor.frame.minY, before, accuracy: 8) }
        XCTAssertEqual(message.value as? String, "My next thought stays here")
        attachScreenshot(app, name: "Native chat – reading while reply stops")
        // Sending from a frozen history window must first confirm the latest page.
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
        message.tap(); message.typeText("My next thought stays here")
        transcript.swipeDown()
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        latest.tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].isHittable)
        attachScreenshot(app, name: "Native chat – latest reply and new draft")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        openSidebar(app)
        conversation.tap()
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertEqual(message.value as? String, "My next thought stays here")

        var request = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/offline")!)
        request.httpMethod = "POST"; request.timeoutInterval = 5
        _ = try await URLSession.shared.data(for: request)
        let reconnecting = app.buttons["connectionPill"]
        XCTAssertTrue(reconnecting.waitForExistence(timeout: 3))
        XCTAssertTrue(reconnecting.label.contains("Test Mac: Reconnecting"))
        XCTAssertEqual(message.value as? String, "My next thought stays here")
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: app.buttons["sendMessage"])
        let enabledResult = await XCTWaiter.fulfillment(of: [enabled], timeout: 10)
        XCTAssertEqual(enabledResult, .completed)
        XCTAssertEqual(message.value as? String, "My next thought stays here")
        attachScreenshot(app, name: "Native chat – recovered connection")
        forgetFixture(app)
    }

    func testPairReadSendStreamAndRestore() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let conversation = pairFixture(app, code: "ios-test")
        conversation.tap()
        XCTAssertTrue(app.staticTexts["Hello from the computer."].waitForExistence(timeout: 10))

        let message = app.textViews["messageInput"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("Hello from native iOS")
        app.buttons["sendMessage"].tap()
        let consent = app.buttons["allowDataSharing"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        let liveReply = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Streaming a native reply")).firstMatch
        XCTAssertTrue(liveReply.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Native reply delivered.")).count, 1)

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native conversation"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        app.terminate()
        app.launch()
        openSidebar(app)
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 10))

        app.navigationBars.buttons.element(boundBy: 0).tap()
        let newMessage = app.textViews["homeMessageInput"]
        XCTAssertTrue(newMessage.waitForExistence(timeout: 5))
        newMessage.tap()
        newMessage.typeText("Start a native conversation")
        app.buttons["startConversation"].tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))

        // Leave the installed app ready for the developer's real pairing.
        forgetFixture(app)
    }

    private func pairFixture(_ app: XCUIApplication, code: String, search: Bool = false) -> XCUIElement {
        prepareUnpaired(app)
        app.buttons["scanPairingCode"].tap()
        let field = app.textFields["pairingLink"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(fixtureLink(code))
        app.buttons["reviewConnection"].tap()
        let confirm = app.buttons["confirmPairing"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        openSidebar(app)
        if search {
            app.buttons["Search"].tap()
            let field = app.textFields["globalSearchInput"]
            XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("Summarize")
            let found = app.buttons["search-run-fixture-run"]
            XCTAssertTrue(found.waitForExistence(timeout: 5)); return found
        }
        let conversation = app.buttons["conversation-fixture-run"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        return conversation
    }

    private func fixtureLink(_ code: String) -> String {
        "mains://pair#code=\(code)&name=Test%20Mac&endpoint=http%3A%2F%2F127.0.0.1%3A18787"
    }

    private func prepareUnpaired(_ app: XCUIApplication) {
        app.launch()
        if !app.buttons["scanPairingCode"].waitForExistence(timeout: 2) {
            openSidebar(app)
            app.buttons["openSettings"].tap()
            if app.staticTexts["Demo Mac"].exists {
                let exit = app.buttons["exitDemo"]
                scrollTo(exit, in: app); exit.tap()
                XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))
                return
            }
            guard app.staticTexts["Test Mac"].exists else {
                XCTFail("Use the dedicated QA simulator; only the Test Mac pairing may be reset.")
                return
            }
            forgetFromSettings(app)
        }
        XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))
    }

    private func forgetFixture(_ app: XCUIApplication) {
        if !app.buttons["openSidebar"].exists && !app.buttons["openSettings"].exists { app.navigationBars.buttons.element(boundBy: 0).tap() }
        openSidebar(app)
        app.buttons["openSettings"].tap()
        forgetFromSettings(app)
        XCTAssertTrue(app.buttons["scanPairingCode"].waitForExistence(timeout: 5))
    }

    private func openSidebar(_ app: XCUIApplication) {
        if app.buttons["closeSidebar"].exists { return }
        let button = app.buttons["openSidebar"]
        XCTAssertTrue(button.waitForExistence(timeout: 15)); button.tap()
        XCTAssertTrue(app.buttons["openSettings"].waitForExistence(timeout: 5))
    }

    private func forgetFromSettings(_ app: XCUIApplication) {
        let forget = app.buttons["forgetComputer"]
        for _ in 0..<8 {
            if forget.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(forget.isHittable)
        forget.tap()
        let confirmation = app.alerts["Forget this computer?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        XCTAssertTrue(confirmation.buttons["Cancel"].exists)
        confirmation.buttons["Forget"].tap()
    }

    private func chooseSidebarMode(_ mode: String, in app: XCUIApplication) async {
        let button = app.buttons["sidebarMode-" + mode]
        XCTAssertTrue(button.waitForExistence(timeout: 5)); button.tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true AND enabled == true"), object: button)
        let result = await XCTWaiter.fulfillment(of: [saved], timeout: 10)
        XCTAssertEqual(result, .completed)
        XCTAssertTrue(app.buttons["closeSidebar"].exists, "Changing the mode keeps the sidebar open.")
        XCTAssertTrue(app.buttons["openSettings"].isHittable)
    }

    private func chooseModel(_ id: String, in app: XCUIApplication) {
        let picker = app.buttons["selectModel"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5)); picker.tap()
        let model = app.buttons["model-" + id]
        XCTAssertTrue(model.waitForExistence(timeout: 5)); model.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        XCTAssertFalse(model.exists)
    }

    private func selectEffort(at fraction: CGFloat, in app: XCUIApplication, drag: Bool = false) {
        let slider = app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch
        XCTAssertTrue(slider.waitForExistence(timeout: 5))
        let start = slider.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 34, dy: slider.frame.height / 2))
        let end = slider.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 34 + fraction * (slider.frame.width - 68), dy: slider.frame.height / 2))
        if drag { start.press(forDuration: 0.1, thenDragTo: end) }
        else { end.tap() }
    }

    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
