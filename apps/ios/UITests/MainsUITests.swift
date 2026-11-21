import XCTest
import UIKit

/// Run alongside scripts/mock-backend.mjs. No AI provider or real workspace is contacted.
@MainActor
final class MainsUITests: XCTestCase {
    func testInterruptedReplyNoticeAlignsWithComposerWhileTyping() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        pairFixture(app, code: "ios-test-reply-interrupted").tap()

        let input = app.textViews["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))

        let notice = app.descendants(matching: .any)["replyInterruptedNotice"].firstMatch
        let composer = app.descendants(matching: .any)["messageComposer"].firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertTrue(composer.exists)
        XCTAssertTrue(notice.staticTexts["Reply interrupted"].isHittable)
        XCTAssertEqual(notice.frame.minX, composer.frame.minX, accuracy: 1)
        XCTAssertEqual(notice.frame.maxX, composer.frame.maxX, accuracy: 1)
        XCTAssertLessThan(notice.frame.maxY, composer.frame.minY)
        attachScreenshot(app, name: "Interrupted reply above composer")

        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testArchivedMateKeepsItsIdentityInAnOldRequestAndChat() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        pairFixture(app, code: "ios-test-archived-mate").tap()
        XCTAssertTrue(app.staticTexts["Historical release report."].waitForExistence(timeout: 10))
        let request = app.buttons["openMateAssignment-fixture-old-mate-request"]
        XCTAssertTrue(request.exists)
        XCTAssertTrue(request.label.contains("Fixture Mate"))
        XCTAssertTrue(request.label.contains("Completed"))
        let openChat = app.buttons["openMateTaskChat"]
        XCTAssertTrue(openChat.waitForExistence(timeout: 5))
        XCTAssertEqual(openChat.label, "Open archived Mate chat")
        attachScreenshot(app, name: "Archived Mate request")
        openChat.tap()
        XCTAssertTrue(app.staticTexts["Historical Mate reply."].waitForExistence(timeout: 10))
        let header = app.descendants(matching: .any).matching(identifier: "mateConversationHeader").firstMatch
        let namedArchive = NSPredicate(format: "label == %@", "Fixture Mate, archived Mate")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: namedArchive, object: header)], timeout: 8), .completed)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "archivedMateConversationNotice").firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Restore this Mate on your computer to send messages."].exists)
        XCTAssertFalse(app.buttons["restoreMateFromConversation"].exists)
        XCTAssertFalse(app.textViews["messageInput"].exists)
        XCTAssertFalse(app.buttons["newConversation"].exists)
        attachScreenshot(app, name: "Archived Mate chat")
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testArchivedMateRestoresFromItsConversationUsingTheOriginalReceipt() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        pairFixture(app, code: "ios-test-restore-mate").tap()
        let openChat = app.buttons["openMateTaskChat"]
        XCTAssertTrue(openChat.waitForExistence(timeout: 5))
        openChat.tap()
        let history = app.staticTexts["Historical Mate reply."]
        XCTAssertTrue(history.waitForExistence(timeout: 5))

        let notice = app.descendants(matching: .any)["archivedMateConversationNotice"].firstMatch
        let restore = notice.buttons["restoreMateFromConversation"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        XCTAssertTrue(restore.label.contains("Restore Mate"))
        XCTAssertTrue(restore.isEnabled)
        XCTAssertGreaterThanOrEqual(restore.frame.height, 44)
        XCTAssertFalse(app.textViews["messageInput"].exists)
        attachScreenshot(app, name: "Archived Mate restore card")
        restore.tap()
        let check = NSPredicate(format: "label CONTAINS %@", "Check Mate change")
        let result = await XCTWaiter.fulfillment(of: [XCTNSPredicateExpectation(predicate: check, object: restore)], timeout: 5)
        XCTAssertEqual(result, .completed)
        XCTAssertFalse(app.textViews["messageInput"].exists)
        restore.tap()

        XCTAssertTrue(app.textViews["messageInput"].waitForExistence(timeout: 5))
        XCTAssertFalse(restore.exists)
        XCTAssertTrue(history.exists)
        let header = app.descendants(matching: .any)["mateConversationHeader"].firstMatch
        XCTAssertEqual(header.label, "Fixture Mate")

        let url = URL(string: "http://127.0.0.1:18787/observations")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let writes = calls.filter { $0["channel"] as? String == "assistants:mobileManage" }
        XCTAssertEqual(writes.count, 2)
        XCTAssertEqual(Set(writes.compactMap { $0["commandId"] as? String }).count, 1)
        let arguments = try XCTUnwrap(writes.first?["args"] as? [Any])
        XCTAssertEqual(arguments[1] as? String, "fixture-mate")
        let change = try XCTUnwrap(arguments[2] as? [String: Any])
        XCTAssertEqual(change["action"] as? String, "archive")
        XCTAssertEqual(change["archived"] as? Bool, false)

        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testFullScreenHeaderButtonsAlignWithTheNewChatHeader() {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        let logo = app.images["sidebarMainsLogo"]
        XCTAssertTrue(logo.waitForExistence(timeout: 5))
        let sidebarHeaderY = logo.frame.midY
        app.buttons["closeSidebar"].tap()
        let sidebar = app.buttons["openSidebar"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 5))
        let reference = sidebar.frame
        XCTAssertEqual(reference.midY, sidebarHeaderY, accuracy: 1)
        attachScreenshot(app, name: "New chat header")

        func checkLeadingButton(file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
            let back = app.navigationBars.buttons["BackButton"]
            XCTAssertTrue(back.waitForExistence(timeout: 5), file: file, line: line)
            XCTAssertEqual(back.frame.midY, reference.midY, accuracy: 1, file: file, line: line)
            XCTAssertEqual(back.frame.midX, reference.midX, accuracy: 1, file: file, line: line)
            return back
        }

        func checkPageTitle(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
            let page = app.staticTexts["pageTitle"]
            XCTAssertTrue(page.waitForExistence(timeout: 5), file: file, line: line)
            XCTAssertEqual(page.label, title, file: file, line: line)
            XCTAssertGreaterThan(page.frame.minY, app.navigationBars[title].frame.maxY, file: file, line: line)
            XCTAssertFalse(app.staticTexts["inlinePageTitle"].exists, file: file, line: line)
        }

        openSidebar(app)
        app.buttons["openAtlas"].tap()
        XCTAssertTrue(app.navigationBars["Atlas"].waitForExistence(timeout: 5))
        let atlasBack = checkLeadingButton()
        checkPageTitle("Atlas")
        attachScreenshot(app, name: "Atlas header")
        let report = app.buttons["atlasItem-fixture-atlas-doc"]
        XCTAssertTrue(report.waitForExistence(timeout: 5))
        app.swipeUp()
        let compactTitle = app.staticTexts["inlinePageTitle"]
        XCTAssertTrue(compactTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(compactTitle.label, "Atlas")
        XCTAssertEqual(compactTitle.frame.midX, app.frame.midX, accuracy: 3)
        attachScreenshot(app, name: "Atlas scrolled header")
        app.swipeDown()
        XCTAssertTrue(compactTitle.waitForNonExistence(timeout: 5))
        checkPageTitle("Atlas")
        report.tap()
        let closePreview = app.buttons["Close preview"]
        XCTAssertTrue(closePreview.waitForExistence(timeout: 5))
        XCTAssertEqual(closePreview.frame.midY, reference.midY, accuracy: 1)
        XCTAssertEqual(closePreview.frame.midX, reference.midX, accuracy: 1)
        attachScreenshot(app, name: "File preview header")
        closePreview.tap()

        app.buttons["atlasItem-fixture-atlas-page"].tap()
        let pageTitle = app.staticTexts["atlasPageTitle"]
        XCTAssertTrue(pageTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(pageTitle.label, "Travel notes")
        XCTAssertFalse(compactTitle.exists)
        let reader = app.scrollViews.firstMatch
        reader.swipeUp()
        XCTAssertTrue(compactTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(compactTitle.label, "Travel notes")
        XCTAssertEqual(compactTitle.frame.midX, app.frame.midX, accuracy: 3)
        attachScreenshot(app, name: "Atlas Page scrolled title")
        reader.swipeDown()
        XCTAssertTrue(compactTitle.waitForNonExistence(timeout: 5))
        XCTAssertTrue(pageTitle.isHittable)
        checkLeadingButton().tap()
        atlasBack.tap()

        openSidebar(app)
        app.buttons["openMates"].tap()
        XCTAssertTrue(app.navigationBars["Mates"].waitForExistence(timeout: 5))
        let matesBack = checkLeadingButton()
        checkPageTitle("Mates")
        let addMate = app.buttons["newMate"]
        XCTAssertTrue(addMate.exists)
        XCTAssertEqual(addMate.frame.midY, reference.midY, accuracy: 1)
        XCTAssertEqual(app.frame.maxX - addMate.frame.midX, reference.midX - app.frame.minX, accuracy: 1)
        attachScreenshot(app, name: "Mates header")
        let firstMate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(firstMate.waitForExistence(timeout: 5))
        let firstMateY = firstMate.frame.minY
        addMate.tap()
        XCTAssertTrue(app.navigationBars["New Mate"].waitForExistence(timeout: 5))
        let newMateBack = checkLeadingButton()
        XCTAssertEqual(app.buttons["nextMateStep"].frame.midY, reference.midY, accuracy: 1)
        attachScreenshot(app, name: "New Mate header")
        let name = app.textFields["mateName"]
        let avatar = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "mate-avatar-carousel")).firstMatch
        XCTAssertTrue(avatar.waitForExistence(timeout: 5))
        let avatarFrame = avatar.frame
        let avatarChoice = avatar.value as? String
        let nameCenter = name.frame.midY
        name.tap()
        name.typeText("Hi")
        app.buttons["nextMateStep"].tap()
        XCTAssertTrue(app.navigationBars["Model & Effort"].waitForExistence(timeout: 5))
        let modelBack = checkLeadingButton()
        XCTAssertEqual(app.buttons["createMate"].frame.midY, reference.midY, accuracy: 1)
        let namePreview = app.staticTexts["newMateNamePreview"]
        XCTAssertEqual(namePreview.label, "Hi")
        XCTAssertLessThan(namePreview.frame.midY, nameCenter)
        XCTAssertEqual(avatar.value as? String, avatarChoice)
        XCTAssertEqual(avatar.frame.midX, avatarFrame.midX, accuracy: 1)
        XCTAssertLessThan(avatar.frame.width, avatarFrame.width)
        XCTAssertLessThan(avatar.frame.midY, avatarFrame.midY - 48)
        attachScreenshot(app, name: "Model & Effort header")

        let stageCenter = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width / 2, dy: avatar.frame.midY - app.frame.minY))
        stageCenter.press(forDuration: 0.05, thenDragTo: stageCenter.withOffset(CGVector(dx: -100, dy: 0)))
        XCTAssertEqual(avatar.value as? String, avatarChoice)

        modelBack.tap()
        XCTAssertTrue(app.navigationBars["New Mate"].waitForExistence(timeout: 5))
        XCTAssertEqual(name.value as? String, "Hi")
        XCTAssertTrue(app.buttons["mate-avatar-style-terminal"].exists)
        XCTAssertEqual(avatar.value as? String, avatarChoice)
        newMateBack.tap()
        XCTAssertTrue(app.navigationBars["Mates"].waitForExistence(timeout: 5))
        XCTAssertEqual(firstMate.frame.minY, firstMateY, accuracy: 1)
        matesBack.tap()

        openSidebar(app)
        app.buttons["openWorkInbox"].tap()
        XCTAssertTrue(app.navigationBars["Activity"].waitForExistence(timeout: 5))
        checkPageTitle("Activity")
        attachScreenshot(app, name: "Activity header")
        checkLeadingButton().tap()

        openSidebar(app)
        app.buttons["openSettings"].tap()
        checkPageTitle("Settings")
        app.swipeUp()
        XCTAssertTrue(compactTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(compactTitle.label, "Settings")
        XCTAssertEqual(compactTitle.frame.midX, app.frame.midX, accuracy: 3)
        app.swipeDown()
        XCTAssertTrue(compactTitle.waitForNonExistence(timeout: 5))
        checkLeadingButton().tap()

        openSidebar(app)
        app.buttons["conversation-fixture-run"].tap()
        let options = app.buttons["conversationOptions"]
        XCTAssertTrue(options.waitForExistence(timeout: 5))
        _ = checkLeadingButton()
        XCTAssertEqual(options.frame.midY, reference.midY, accuracy: 1)
        attachScreenshot(app, name: "Code conversation header")
    }

    private func makeApplication() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["MAINS_HOT_RELOAD"] = "0"
        return app
    }

    func testAtlasEmptyStatesFollowCategoryAndSearch() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test")
        var empty = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/empty-atlas-library")!)
        empty.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: empty)
        app.buttons["openAtlas"].tap()
        let filters = app.buttons["atlasFilters"]
        XCTAssertTrue(filters.waitForExistence(timeout: 5))
        let search = app.searchFields["Search Atlas"]

        let categories = [("all", "No items here yet"), ("page", "No pages yet"), ("file", "No documents yet"),
                          ("image", "No images yet"), ("bookmark", "No bookmarks yet")]
        for (category, title) in categories {
            let chip = app.buttons["atlasType-" + category]
            let row = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: 0, dy: filters.frame.midY - app.frame.minY))
            if category == "image" {
                row.withOffset(CGVector(dx: app.frame.width * 0.78, dy: 0))
                    .press(forDuration: 0.05, thenDragTo: row.withOffset(CGVector(dx: app.frame.width * 0.15, dy: 0)))
            }
            if !chip.isSelected { chip.tap() }
            let heading = app.staticTexts[title]
            XCTAssertTrue(heading.waitForExistence(timeout: 5))
            XCTAssertEqual(heading.frame.midX, app.frame.midX, accuracy: 2)
            let contentMidY = (filters.frame.maxY + search.frame.minY) / 2
            XCTAssertGreaterThan(heading.frame.midY, contentMidY)
            XCTAssertLessThan(heading.frame.midY, contentMidY + 100)
            attachScreenshot(app, name: "Atlas empty " + category)
        }

        search.tap()
        search.typeText("Travel")
        XCTAssertTrue(app.staticTexts["No matches"].waitForExistence(timeout: 5))
        app.buttons["close"].tap()
        XCTAssertTrue(app.staticTexts["No bookmarks yet"].waitForExistence(timeout: 5))
        app.buttons["atlasOptions"].tap()
        app.buttons["openAtlasTrash"].tap()
        let trash = app.navigationBars["Trash"]
        XCTAssertTrue(trash.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Trash is empty"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Atlas empty Trash")
        trash.buttons["Close"].tap()

        app.terminate()
        app.launchArguments = ["-appearancePreference", "light"]
        app.launch()
        openSidebar(app)
        app.buttons["openAtlas"].tap()
        let pages = app.buttons["atlasType-page"]
        XCTAssertTrue(pages.waitForExistence(timeout: 5))
        pages.tap()
        XCTAssertTrue(app.staticTexts["No pages yet"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Atlas empty Pages light")
        app.navigationBars["Atlas"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testAtlasTagFilterSearchesAndClearsFromCompactSheet() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test")
        app.buttons["openAtlas"].tap()
        let report = app.buttons["atlasItem-fixture-atlas-doc"]
        XCTAssertTrue(report.waitForExistence(timeout: 5))

        let filters = app.buttons["atlasFilters"]
        let compactTitle = app.staticTexts["inlinePageTitle"]
        attachScreenshot(app, name: "Atlas filters at rest")
        XCTAssertTrue(filters.waitForExistence(timeout: 5))
        XCTAssertTrue(filters.isHittable, "\(filters.frame)")
        let restingFilterY = filters.frame.minY
        app.swipeUp()
        XCTAssertTrue(compactTitle.waitForExistence(timeout: 5))
        let pinnedFilterY = filters.frame.minY
        XCTAssertLessThan(pinnedFilterY, restingFilterY)
        XCTAssertEqual(pinnedFilterY, app.navigationBars["Atlas"].frame.maxY, accuracy: 6)
        app.swipeUp()
        XCTAssertEqual(filters.frame.minY, pinnedFilterY, accuracy: 2)
        XCTAssertTrue(filters.isHittable)
        attachScreenshot(app, name: "Atlas pinned filters")
        let all = app.buttons["atlasType-all"]
        XCTAssertTrue(all.isHittable, "\(all.frame)")
        XCTAssertEqual(all.frame.midY, filters.frame.midY, accuracy: 6)

        func openTagFilter() {
            filters.tap()
            app.buttons["Tag…"].tap()
            XCTAssertTrue(app.navigationBars["Filter by tag"].waitForExistence(timeout: 5))
        }

        openTagFilter()
        let search = app.textFields["searchAtlasTags"]
        let research = app.buttons["atlasTag-fixture-tag-research"]
        let work = app.buttons["atlasTag-fixture-tag-work"]
        XCTAssertTrue(search.exists)
        XCTAssertTrue(work.waitForExistence(timeout: 5))
        XCTAssertEqual(research.label, "#Research")
        XCTAssertFalse(app.buttons["All tags"].exists)
        XCTAssertLessThan(search.frame.maxY, research.frame.minY)
        XCTAssertLessThan(work.frame.midY - research.frame.midY, 56)
        attachScreenshot(app, name: "Atlas tag filter")

        search.tap()
        search.typeText("res")
        XCTAssertTrue(work.waitForNonExistence(timeout: 5))
        XCTAssertTrue(research.waitForExistence(timeout: 5))
        XCTAssertFalse(work.exists)
        research.tap()
        XCTAssertTrue(app.buttons["Reset"].waitForExistence(timeout: 5))
        XCTAssertTrue(report.waitForNonExistence(timeout: 5))

        openTagFilter()
        app.buttons["Clear tag filter"].tap()
        XCTAssertTrue(report.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Reset"].waitForNonExistence(timeout: 5))
        app.swipeDown()
        app.swipeDown()
        XCTAssertTrue(compactTitle.waitForNonExistence(timeout: 5))
        XCTAssertEqual(filters.frame.minY, restingFilterY, accuracy: 4)
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testAtlasKeepsScrolledLibraryVisibleWhileFavoriteAndTrashRefresh() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["openAtlas"].tap()
        XCTAssertTrue(app.buttons["atlasItem-fixture-atlas-doc"].waitForExistence(timeout: 5))

        let item = app.buttons["atlasItem-fixture-atlas-page-9"]
        let neighbor = app.buttons["atlasItem-fixture-atlas-page-8"]
        scrollTo(item, in: app)
        XCTAssertTrue(neighbor.isHittable)
        XCTAssertTrue(app.staticTexts["inlinePageTitle"].exists)
        let neighborY = neighbor.frame.minY

        var delay = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/delay-atlas-library")!)
        delay.httpMethod = "POST"
        delay.httpBody = Data(#"{"durationMs":5000}"#.utf8)
        _ = try await URLSession.shared.data(for: delay)

        func assertRetainedPage() {
            XCTAssertTrue(neighbor.isHittable)
            XCTAssertEqual(neighbor.frame.minY, neighborY, accuracy: 3)
            XCTAssertFalse(app.staticTexts["Loading Atlas…"].exists)
        }

        item.press(forDuration: 0.7)
        app.buttons["Add to favorites"].tap()
        assertRetainedPage()
        XCTAssertFalse(item.label.contains("Favorite"))
        let favorite = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Favorite"), object: item)
        let favoriteResult = await XCTWaiter.fulfillment(of: [favorite], timeout: 9)
        XCTAssertEqual(favoriteResult, .completed)
        assertRetainedPage()

        item.press(forDuration: 0.7)
        app.buttons["Move to Trash"].tap()
        assertRetainedPage()
        XCTAssertTrue(item.exists)
        XCTAssertTrue(item.waitForNonExistence(timeout: 9))
        assertRetainedPage()

        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testAtlasMoveToProjectUsesWorkChatPicker() async {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-home")
        chooseSidebarSpace("fixture-claude", in: app)
        openSidebar(app)
        await chooseSidebarMode("work", in: app)
        app.buttons["conversation-fixture-work"].tap()
        app.buttons["conversationOptions"].tap()
        app.buttons["moveConversationToProject"].tap()

        let sheet = app.navigationBars["Move to project"]
        let close = sheet.buttons["Close"]
        let search = app.searchFields["Search projects"]
        let chatNoProject = app.buttons["moveChatNoProject"]
        let chatProject = app.buttons["moveChatProject-fixture-kitchen"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertTrue(search.exists)
        let workLayout = [chatNoProject.frame, chatProject.frame, search.frame]
        attachScreenshot(app, name: "Work chat project picker")
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()

        openSidebar(app)
        app.buttons["openAtlas"].tap()
        let page = app.buttons["atlasItem-fixture-atlas-page"]
        XCTAssertTrue(page.waitForExistence(timeout: 5))
        page.tap()
        app.buttons["atlasPageOptions"].tap()
        app.buttons["moveAtlasPage"].tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        let atlasNoProject = app.buttons["atlasMove-none"]
        let atlasProject = app.buttons["atlasMove-fixture-kitchen"]
        XCTAssertTrue(atlasNoProject.isEnabled, "Older computers may omit the page’s current project.")
        XCTAssertEqual([atlasNoProject.frame, atlasProject.frame, search.frame], workLayout)
        attachScreenshot(app, name: "Atlas Page project picker")
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()

        func moveFromLibrary() {
            XCTAssertTrue(page.waitForExistence(timeout: 5))
            page.press(forDuration: 0.7)
            app.buttons["Move to project"].tap()
            XCTAssertTrue(close.waitForExistence(timeout: 5))
        }
        moveFromLibrary()
        XCTAssertFalse(atlasNoProject.isEnabled)
        search.tap()
        search.typeText("Kitchen")
        XCTAssertTrue(app.buttons["atlasMove-fixture-life"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(atlasProject.exists)
        atlasProject.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))

        moveFromLibrary()
        XCTAssertFalse(atlasProject.isEnabled)
        XCTAssertTrue(atlasNoProject.isEnabled)
        atlasNoProject.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testAtlasPageCoverDoesNotDelayItsCompactTitle() {
        continueAfterFailure = false
        let app = makeApplication()
        XCUIDevice.shared.orientation = .portrait
        addTeardownBlock { await MainActor.run { XCUIDevice.shared.orientation = .portrait } }
        prepareUnpaired(app)
        app.buttons["startDemo"].tap()
        openSidebar(app)
        app.buttons["openAtlas"].tap()
        let page = app.buttons["atlasItem-demo-atlas-page"]
        XCTAssertTrue(page.waitForExistence(timeout: 5))
        page.tap()
        let title = app.staticTexts["atlasPageTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.label, "Explore Atlas")

        // A short viewport lets the sample cover and title scroll behind the toolbar.
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 5), .completed)
        let bar = app.navigationBars.firstMatch
        let compactTitle = app.staticTexts["inlinePageTitle"]
        let isExpanded = compactTitle.waitForNonExistence(timeout: 5)
        XCTAssertTrue(isExpanded, "Title: \(title.frame). Navigation bar: \(bar.frame).")
        let reader = app.scrollViews.firstMatch
        let start = reader.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.9))
        let distance = title.frame.maxY - bar.frame.maxY + 26
        let end = start.withOffset(CGVector(dx: 0, dy: -distance))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        let isCompact = compactTitle.waitForExistence(timeout: 5)
        XCTAssertTrue(isCompact, "Title: \(title.frame). Navigation bar: \(bar.frame).")
        XCTAssertEqual(compactTitle.label, "Explore Atlas")
        XCTAssertEqual(compactTitle.frame.midX, bar.frame.midX, accuracy: 3)
        attachScreenshot(app, name: "Atlas cover scrolled title")
        reader.swipeDown()
        XCTAssertTrue(compactTitle.waitForNonExistence(timeout: 5))
    }

    func testCompactSidebarPreservesTheDraftAndSupportsEdgeDismissal() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test")
        let close = app.buttons["closeSidebar"]
        close.tap()

        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let welcome = app.staticTexts["homeWelcomeTitle"]
        XCTAssertEqual(welcome.label, "What’s on your mind?")
        attachScreenshot(app, name: "Expanded Chat welcome title")
        let inputPosition = app.coordinate(withNormalizedOffset: .zero).withOffset(
            CGVector(dx: input.frame.maxX - app.frame.minX - 8, dy: input.frame.midY - app.frame.minY))
        let draft = "Keep this draft behind the sidebar"
        input.tap()
        input.typeText(draft)
        XCTAssertFalse(welcome.exists)
        openSidebar(app)
        let settings = app.buttons["openSettings"]
        let search = app.buttons["sidebarSearch"]
        XCTAssertEqual(settings.frame.midX, close.frame.midX, accuracy: 1)
        XCTAssertGreaterThan(search.frame.width, app.frame.width / 2)
        let project = app.buttons["collection-fixture-kitchen"]
        XCTAssertEqual(project.label, "Kitchen Notes, expanded")
        project.tap()
        XCTAssertEqual(project.label, "Kitchen Notes, collapsed")
        project.tap()
        XCTAssertEqual(project.label, "Kitchen Notes, expanded")
        attachScreenshot(app, name: "Compact sidebar over Home")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        inputPosition.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertEqual(input.value as? String, draft)

        let leadingEdge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.5))
        let trailingEdge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5))
        let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        leadingEdge.press(forDuration: 0.05, thenDragTo: trailingEdge)
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        trailingEdge.press(forDuration: 0.05, thenDragTo: middle)
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, draft)
        openSidebar(app)
        app.buttons["openProject-fixture-kitchen"].tap()
        XCTAssertTrue(app.textFields["projectSearch"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["pageTitle"].label, "Kitchen Notes")
        XCTAssertTrue(app.staticTexts["No chats in this project yet."].exists)
        attachScreenshot(app, name: "Expanded project title")
        app.buttons["newConversation"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("Kitchen Notes"))
        XCTAssertEqual(input.value as? String, draft)
        openSidebar(app)
        chooseSidebarSpace("fixture-code", in: app)
        openSidebar(app)
        XCTAssertTrue(app.buttons["workspace-fixture-workspace"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Compact sidebar Workspaces")
        forgetFixture(app)
    }

    func testCodeMateMentionShowsItsNameAndOpensTheSeparateTaskChatButton() {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-workspace")
        attachScreenshot(app, name: "Mate icon in the sidebar")
        chooseSidebarSpace("fixture-code", in: app)
        openSidebar(app)
        app.buttons["workspace-fixture-workspace"].tap()
        let conversation = app.buttons["conversation-workspace-first"]
        XCTAssertTrue(conversation.waitForExistence(timeout: 5)); conversation.tap()

        let input = app.textViews.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap()
        input.typeText("@Fixture")
        let mate = app.buttons["context-skill-assistant-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5)); mate.tap()
        let allow = app.buttons["allowDataSharing"]
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        XCTAssertEqual((input.value as? String)?.trimmingCharacters(in: .whitespaces), "Fixture Mate")
        input.typeText("Review the release")
        attachScreenshot(app, name: "Mate mention in the composer")
        app.buttons["Send message"].tap()

        let bubble = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", "Review the release")).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 10))
        XCTAssertEqual(bubble.label.trimmingCharacters(in: .whitespacesAndNewlines), "Fixture Mate Review the release")
        attachScreenshot(app, name: "Mate mention in the sent bubble")

        let review = app.staticTexts["Fixture Mate reviewed the workspace."]
        XCTAssertTrue(review.waitForExistence(timeout: 10))
        let openChat = app.buttons["Open Mate chat"]
        XCTAssertTrue(openChat.exists)
        XCTAssertGreaterThan(openChat.frame.minY, review.frame.maxY)
        attachScreenshot(app, name: "Mate task and separate chat button")
        let transcript = app.scrollViews.containing(.staticText, identifier: "Fixture Mate reviewed the workspace.").firstMatch
        for _ in 0..<3 where !openChat.isHittable { transcript.swipeUp() }
        XCTAssertTrue(openChat.isHittable); openChat.tap()
        XCTAssertTrue(app.staticTexts["Mate chat opened."].waitForExistence(timeout: 10))
        app.navigationBars.buttons["BackButton"].tap()
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateRequestOpensAssignmentAndFollowsUpFromTheConversation() {
        continueAfterFailure = false
        let app = makeApplication()
        pairFixture(app, code: "ios-test-mate-request").tap()
        let request = app.buttons["openMateAssignment-fixture-linked-mate-request"]
        XCTAssertTrue(request.waitForExistence(timeout: 10))
        XCTAssertTrue(request.label.contains("Blocked"))
        XCTAssertTrue(app.buttons["openMateTaskChat"].exists)
        attachScreenshot(app, name: "Mate request and blocked badge")
        request.tap()

        let assignment = app.navigationBars["Assignment"]
        XCTAssertTrue(assignment.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Check the release notes first."].waitForExistence(timeout: 5))
        let followup = app.buttons["Follow Up"]
        scrollTo(followup, in: app)
        followup.tap()
        let form = app.navigationBars["Follow Up"]
        let message = app.textViews["Task message"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("Send the notes for review.")
        form.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["Share data with OpenAI?"].waitForExistence(timeout: 5))
        app.buttons["allowDataSharing"].tap()
        XCTAssertTrue(form.waitForNonExistence(timeout: 5))
        XCTAssertTrue(followup.waitForNonExistence(timeout: 5))

        let chat = app.buttons["Open Chat"]
        scrollTo(chat, in: app)
        chat.tap()
        XCTAssertTrue(assignment.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["I found two release options."].waitForExistence(timeout: 10))
        app.navigationBars.buttons["BackButton"].tap()
        XCTAssertTrue(request.waitForExistence(timeout: 5))
        XCTAssertTrue(request.label.contains("Running"))
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateCreationFollowsTheSelectedAppearance() throws {
        continueAfterFailure = false

        for appearance in ["light", "dark"] {
            let app = makeApplication()
            app.launchArguments += ["-appearancePreference", appearance]
            _ = pairFixture(app, code: "ios-test")

            func checkBackground(_ step: String) throws {
                let screenshot = app.screenshot()
                let image = try XCTUnwrap(screenshot.image.cgImage)
                func sampleColor(x: Int, y: Int) throws -> [Int] {
                    let sample = try XCTUnwrap(image.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)))
                    var bytes = [UInt8](repeating: 0, count: 4)
                    try bytes.withUnsafeMutableBytes { buffer in
                        let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                        context.draw(sample, in: CGRect(x: 0, y: 0, width: 1, height: 1))
                    }
                    return bytes.prefix(3).map(Int.init)
                }
                let brightness = try sampleColor(x: image.width / 8, y: image.height / 4).reduce(0, +) / 3
                if appearance == "light" { XCTAssertGreaterThan(brightness, 190, step) }
                else { XCTAssertLessThan(brightness, 145, step) }
                if step == "New Mate" || step == "Model & Effort" {
                    let statusBar = try sampleColor(x: image.width / 4, y: image.height / 80)
                    let navigationBar = try sampleColor(x: image.width / 4, y: image.height / 12)
                    XCTAssertGreaterThan(statusBar[0] - statusBar[2], 12, "The avatar tint reaches the status bar.")
                    XCTAssertGreaterThan(navigationBar[0] - navigationBar[2], 12, "The avatar tint reaches the navigation bar.")
                }
                let attachment = XCTAttachment(screenshot: screenshot)
                attachment.name = "\(step) – \(appearance)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }

            app.buttons["openMates"].tap()
            let newMate = app.buttons["newMate"]
            XCTAssertTrue(newMate.waitForExistence(timeout: 5))
            newMate.tap()
            let name = app.textFields["mateName"]
            XCTAssertTrue(name.waitForExistence(timeout: 5))
            try checkBackground("New Mate")
            name.tap()
            name.typeText("Theme test")
            app.buttons["nextMateStep"].tap()
            let create = app.buttons["createMate"]
            XCTAssertTrue(create.waitForExistence(timeout: 5))
            try checkBackground("Model & Effort")
            create.tap()
            XCTAssertTrue(app.staticTexts["creatingMateStatus"].waitForExistence(timeout: 5))
            try checkBackground("Creating Mate")

            XCTAssertTrue(app.navigationBars["Theme test"].waitForExistence(timeout: 10))
            app.navigationBars["Theme test"].buttons["BackButton"].tap()
            app.navigationBars["Mates"].buttons["BackButton"].tap()
            forgetFixture(app)
        }
    }

    func testMateAndComposerEffortSlidersBehaveTheSame() {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")

        app.buttons["closeSidebar"].tap()
        app.buttons["chooseModel"].tap()
        assertEffortSliderInteraction(app)
        chooseModel("fixture-thinking", in: app)
        chooseModel("fixture-balanced", in: app)
        XCTAssertEqual(app.descendants(matching: .any)["effortSlider"].value as? String, "Low")
        app.buttons["closeEffortOverlay"].tap()
        XCTAssertTrue(app.buttons["closeEffortOverlay"].waitForNonExistence(timeout: 5))

        openSidebar(app)
        app.buttons["openMates"].tap()
        let newMate = app.buttons["newMate"]
        XCTAssertTrue(newMate.waitForExistence(timeout: 5))
        newMate.tap()
        let name = app.textFields["mateName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Slider test")
        app.buttons["nextMateStep"].tap()

        let mateSlider = app.descendants(matching: .any)["effortSlider"]
        XCTAssertTrue(mateSlider.waitForExistence(timeout: 5))
        XCTAssertLessThan(mateSlider.frame.maxY, app.frame.maxY - 8)
        attachScreenshot(app, name: "New Mate – inline model controls")
        assertEffortSliderInteraction(app)

        chooseModel("fixture-thinking", in: app)
        chooseModel("fixture-balanced", in: app)
        XCTAssertEqual(app.descendants(matching: .any)["effortSlider"].value as? String, "Low")
        app.navigationBars["Model & Effort"].buttons["BackButton"].tap()
        app.navigationBars["New Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    private func assertEffortSliderInteraction(_ app: XCUIApplication) {
        let slider = app.descendants(matching: .any)["effortSlider"]
        XCTAssertTrue(slider.waitForExistence(timeout: 5))
        let center = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        center.tap()
        XCTAssertEqual(slider.value as? String, "Medium")
        let thumbEdge = center.withOffset(CGVector(dx: 16, dy: 0))
        let highBoundary = (slider.frame.width / 2 - 37) / 2
        let pastBoundary = center.withOffset(CGVector(dx: highBoundary + 6, dy: 0))
        thumbEdge.press(forDuration: 0.05, thenDragTo: pastBoundary, withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertEqual(slider.value as? String, "Medium", "Grabbing the edge keeps the thumb center behind the touch.")

        let outsideTrack = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: -0.4))
        thumbEdge.press(forDuration: 0.05, thenDragTo: outsideTrack, withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertEqual(slider.value as? String, "High")

        let vertical = center.withOffset(CGVector(dx: 0, dy: -80))
        center.press(forDuration: 0.05, thenDragTo: vertical, withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertEqual(slider.value as? String, "High")

        let left = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5))
        left.tap()
        XCTAssertEqual(slider.value as? String, "Low")

        let sliderY = slider.frame.minY
        let right = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.90, dy: 0.85))
        left.press(forDuration: 0.05, thenDragTo: right, withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertEqual(slider.value as? String, "High")
        XCTAssertEqual(slider.frame.minY, sliderY, accuracy: 2, "A horizontal drag should keep the picker in place.")
        left.tap()
        XCTAssertEqual(slider.value as? String, "Low")
    }

    func testNewMateSetupUsesChatBubblesAndContinuesInTheFirstConversation() {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-home")
        app.buttons["openMates"].tap()
        let newMate = app.buttons["newMate"]
        XCTAssertTrue(newMate.waitForExistence(timeout: 5))
        newMate.tap()
        let name = app.textFields["mateName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["New Mate"].buttons["BackButton"].exists)
        let next = app.buttons["nextMateStep"]
        let wheel = app.descendants(matching: .any)["selectModel"]
        XCTAssertFalse(next.isEnabled)
        XCTAssertFalse(wheel.exists)
        XCTAssertFalse(app.buttons["createMate"].exists)
        attachScreenshot(app, name: "New Mate – name, avatar and team")
        app.buttons["Team"].tap()
        app.buttons["Release Team"].tap()
        name.tap()
        name.typeText("Kitchen Mate")
        next.tap()

        let modelBar = app.navigationBars["Model & Effort"]
        XCTAssertTrue(modelBar.waitForExistence(timeout: 5))
        XCTAssertFalse(name.exists)
        XCTAssertFalse(app.buttons["Team"].exists)
        XCTAssertFalse(app.buttons["mate-avatar-style-terminal"].exists)
        XCTAssertEqual(app.staticTexts["newMateNamePreview"].label, "Kitchen Mate")
        let codex = app.buttons["mate-provider-codex"], claude = app.buttons["mate-provider-claude_code"]
        XCTAssertTrue(codex.isSelected)
        XCTAssertGreaterThanOrEqual(codex.frame.minY, modelBar.frame.maxY)
        let codexWidth = codex.frame.width, claudeWidth = claude.frame.width
        claude.tap()
        XCTAssertTrue(claude.isSelected)
        XCTAssertTrue(wheel.waitForExistence(timeout: 5))
        XCTAssertEqual(codex.frame.width, codexWidth, accuracy: 1)
        XCTAssertEqual(claude.frame.width, claudeWidth, accuracy: 1)
        attachScreenshot(app, name: "New Mate – Claude provider color")
        codex.tap()
        XCTAssertTrue(codex.isSelected)
        XCTAssertTrue(wheel.waitForExistence(timeout: 5))
        let effort = app.descendants(matching: .any)["effortSlider"]
        XCTAssertTrue(effort.waitForExistence(timeout: 5))
        XCTAssertEqual(wheel.value as? String, "Balanced")
        XCTAssertEqual(effort.value as? String, "Medium")
        attachScreenshot(app, name: "New Mate – model and effort")
        effort.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).tap()
        XCTAssertEqual(effort.value as? String, "Low")
        let right = effort.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        let middle = effort.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        right.press(forDuration: 0.1, thenDragTo: middle)
        XCTAssertEqual(effort.value as? String, "Medium")
        let verticalStart = effort.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.25))
        let verticalEnd = effort.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.75))
        verticalStart.press(forDuration: 0.1, thenDragTo: verticalEnd)
        XCTAssertEqual(effort.value as? String, "Medium")
        middle.press(forDuration: 0.1, thenDragTo: right)
        XCTAssertEqual(effort.value as? String, "High")
        wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.83)).tap()
        XCTAssertTrue(effort.waitForNonExistence(timeout: 5))
        XCTAssertEqual(wheel.value as? String, "Thinking toggle")
        wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.17)).tap()
        XCTAssertTrue(effort.waitForExistence(timeout: 5))
        effort.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(effort.value as? String, "High")

        modelBar.buttons["BackButton"].tap()
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertEqual(name.value as? String, "Kitchen Mate")
        XCTAssertEqual(app.buttons["Team"].value as? String, "Release Team")
        next.tap()
        XCTAssertTrue(effort.waitForExistence(timeout: 5))
        XCTAssertEqual(effort.value as? String, "High")
        app.buttons["createMate"].tap()

        let creating = app.staticTexts["creatingMateStatus"]
        XCTAssertTrue(creating.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["createMate"].exists)
        XCTAssertFalse(wheel.exists)
        attachScreenshot(app, name: "New Mate – creating with the selected avatar")

        let greeting = app.staticTexts["Hi, I’m Kitchen Mate. What would you like me to help with?"]
        let setupAnswer = app.descendants(matching: .any).matching(identifier: "mateSetupAnswer").firstMatch
        let sendAnswer = app.buttons["sendMateSetupAnswer"]
        XCTAssertTrue(greeting.waitForExistence(timeout: 10))
        XCTAssertTrue(setupAnswer.exists)
        XCTAssertEqual(setupAnswer.frame.midY, sendAnswer.frame.midY, accuracy: 3)
        attachScreenshot(app, name: "New Mate – setup conversation")

        setupAnswer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let focusedAnswer = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            setupAnswer.frame.maxY <= sendAnswer.frame.minY
        }, object: setupAnswer)
        XCTAssertEqual(XCTWaiter.wait(for: [focusedAnswer], timeout: 3), .completed)
        setupAnswer.typeText("Help me plan meals")
        XCTAssertLessThanOrEqual(setupAnswer.frame.maxY, sendAnswer.frame.minY)
        let blankY = (greeting.frame.maxY + setupAnswer.frame.minY) / 2
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width / 2, dy: blankY - app.frame.minY)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertEqual(setupAnswer.value as? String, "Help me plan meals")
        setupAnswer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        sendAnswer.tap()
        let allow = app.buttons["allowDataSharing"]
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        XCTAssertTrue(app.staticTexts["What should I focus on first?"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Help me plan meals"].exists)
        setupAnswer.tap()
        setupAnswer.typeText("Quick dinners")
        sendAnswer.tap()
        XCTAssertTrue(app.staticTexts["Preparing the profile…"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "New Mate – preparing the profile")

        let save = app.buttons["saveMateProfile"]
        XCTAssertTrue(save.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Quick dinners"].exists)
        let edit = app.buttons["editMateProfile"]
        if !edit.isHittable { app.scrollViews.firstMatch.swipeUp() }
        edit.tap()
        let description = app.descendants(matching: .any).matching(identifier: "mateProfileDescription").firstMatch
        XCTAssertTrue(description.exists)
        let instructions = app.descendants(matching: .any).matching(identifier: "mateProfileInstructions").firstMatch
        XCTAssertTrue(instructions.exists)
        instructions.tap()
        assertKeyboardVisible(app)
        instructions.typeText(" More detail.")
        let editedInstructions = instructions.value as? String
        XCTAssertTrue(editedInstructions?.contains("More detail.") == true)
        attachScreenshot(app, name: "New Mate – editing the profile draft")

        let keyboard = app.keyboards.firstMatch
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width - 8, dy: description.frame.midY)).tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        XCTAssertEqual(instructions.value as? String, editedInstructions)
        edit.tap()
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "New Mate – profile draft")
        save.tap()

        let idle = app.staticTexts["Profile saved. What would you like me to do first?"]
        XCTAssertTrue(idle.waitForExistence(timeout: 10))
        let firstTask = app.textViews["homeMessageInput"]
        XCTAssertTrue(firstTask.exists)
        let startTask = app.buttons["startConversation"]
        XCTAssertEqual(firstTask.frame.midY, startTask.frame.midY, accuracy: 3)
        firstTask.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let focusedTask = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            firstTask.frame.maxY <= startTask.frame.minY
        }, object: firstTask)
        XCTAssertEqual(XCTWaiter.wait(for: [focusedTask], timeout: 3), .completed)
        firstTask.typeText("Make a prep list")
        XCTAssertLessThanOrEqual(firstTask.frame.maxY, startTask.frame.minY)
        startTask.tap()
        XCTAssertTrue(app.buttons["newConversation"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 10))
        XCTAssertTrue(greeting.exists)
        XCTAssertTrue(app.staticTexts["Help me plan meals"].exists)
        XCTAssertTrue(app.staticTexts["Quick dinners"].exists)
        let firstMessage = app.staticTexts["Make a prep list"]
        XCTAssertTrue(firstMessage.exists)
        XCTAssertLessThan(greeting.frame.minY, firstMessage.frame.minY)
        XCTAssertLessThan(idle.frame.minY, firstMessage.frame.minY)
        attachScreenshot(app, name: "New Mate – setup history in the first chat")

        app.navigationBars.buttons["BackButton"].tap()
        app.navigationBars["Kitchen Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateChatKeepsItsHeaderWhileTheProfileLoads() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        let chat = app.staticTexts["Release check 1"]
        XCTAssertTrue(chat.waitForExistence(timeout: 5))

        var hold = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/hold-mate-details")!)
        hold.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: hold)
        chat.tap()

        let header = app.descendants(matching: .any).matching(identifier: "mateConversationHeader").firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 3))
        XCTAssertEqual(header.label, "Mate")
        XCTAssertFalse(app.navigationBars["Release check 1"].exists)
        let nameBottom = header.frame.maxY
        let backButton = app.navigationBars.buttons["BackButton"]
        let toolbarCenter = backButton.frame.midY
        attachScreenshot(app, name: "Mate chat – avatar placeholder")

        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Fixture Mate"), object: header)
        let result = await XCTWaiter.fulfillment(of: [loaded], timeout: 10)
        XCTAssertEqual(result, .completed)
        XCTAssertEqual(header.frame.maxY, nameBottom, accuracy: 1)
        XCTAssertEqual(backButton.frame.midY, toolbarCenter, accuracy: 1)
        attachScreenshot(app, name: "Mate chat – avatar loaded")

        let transcript = app.staticTexts["Check whether the build is ready."]
        XCTAssertTrue(transcript.waitForExistence(timeout: 5))
        let transcriptY = transcript.frame.minY
        let avatar = app.coordinate(withNormalizedOffset: .zero).withOffset(
            CGVector(dx: header.frame.midX - app.frame.minX, dy: header.frame.minY - app.frame.minY + 70))
        avatar.tap()
        XCTAssertTrue(app.navigationBars["Mate Details"].waitForExistence(timeout: 5))
        let profileName = app.staticTexts["mateInfoName"]
        XCTAssertTrue(profileName.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(profileName.frame.minY, nameBottom)
        XCTAssertTrue(app.staticTexts["Checks releases"].exists)
        attachScreenshot(app, name: "Mate chat – expanded Mate Details")
        app.buttons["closeMateChatInfo"].tap()
        XCTAssertTrue(header.waitForExistence(timeout: 5))
        XCTAssertEqual(transcript.frame.minY, transcriptY, accuracy: 3)

        backButton.tap()
        XCTAssertTrue(chat.waitForExistence(timeout: 5))
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMatesGroupByTeamAndOpenChatWithMateHeader() throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["openMates"].tap()

        let firstMate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(firstMate.waitForExistence(timeout: 5))
        let rows = [
            app.staticTexts["Release Team"], firstMate, app.buttons["mate-fixture-reviewer"],
            app.staticTexts["Planning Team"], app.buttons["mate-fixture-planner"],
            app.staticTexts["No team"], app.buttons["mate-fixture-solo"],
        ]
        for row in rows { XCTAssertTrue(row.exists) }
        let offsets = rows.map { $0.frame.minY }
        XCTAssertEqual(offsets, offsets.sorted())
        XCTAssertFalse(app.staticTexts["Empty Team"].exists)
        XCTAssertTrue(app.buttons["mate-fixture-reviewer"].label.contains("Finish setup"))
        attachScreenshot(app, name: "Mates – grouped by team")

        let rowEdge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.946, dy: 0))
        rowEdge.withOffset(CGVector(dx: 0, dy: firstMate.frame.midY - app.frame.minY)).tap()
        XCTAssertTrue(app.staticTexts["1m ago"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1d ago"].exists)
        let firstChat = app.staticTexts["Release check 1"]
        let firstDay = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["Today", "Yesterday"])).firstMatch
        XCTAssertTrue(firstDay.exists)
        XCTAssertLessThan(firstDay.frame.midY, firstChat.frame.midY)
        let description = app.staticTexts["Checks releases"]
        XCTAssertTrue(description.exists)
        XCTAssertEqual(description.frame.midX, app.frame.midX, accuracy: 2)
        XCTAssertFalse(app.staticTexts["Codex"].exists)
        let screenshot = try XCTUnwrap(app.screenshot().image.cgImage)
        let scale = CGFloat(screenshot.width) / app.frame.width
        func backgroundPatch(x: CGFloat, y: CGFloat) throws -> Data {
            let rect = CGRect(x: (x * scale).rounded(), y: (y * scale).rounded(), width: 6, height: 6)
            return try XCTUnwrap(UIImage(cgImage: XCTUnwrap(screenshot.cropping(to: rect))).pngData())
        }
        let profileBackground = try backgroundPatch(x: 6, y: description.frame.midY)
        XCTAssertEqual(profileBackground, try backgroundPatch(x: 38, y: description.frame.midY))
        XCTAssertNotEqual(profileBackground, try backgroundPatch(x: 6, y: app.frame.maxY - 20))
        attachScreenshot(app, name: "Mate – centered profile summary and chats")

        let info = app.buttons["openMateInfo"]
        let mateBar = app.navigationBars["Fixture Mate"]
        XCTAssertEqual(info.frame.midY, mateBar.buttons["BackButton"].frame.midY, accuracy: 1)
        info.tap()
        let infoBar = app.navigationBars["Mate Details"]
        XCTAssertTrue(infoBar.waitForExistence(timeout: 5))
        XCTAssertTrue(description.waitForExistence(timeout: 5))
        XCTAssertTrue(mateInfoRow(containing: "Release Team", in: app).exists)
        XCTAssertTrue(mateInfoRow(containing: "Release Workspace", in: app).exists)
        XCTAssertTrue(mateInfoRow(containing: "Balanced", in: app).exists)
        XCTAssertTrue(mateInfoRow(containing: "High", in: app).exists)
        let instructions = app.staticTexts["Summarize release risks and link the checks."]
        XCTAssertTrue(instructions.waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Mate Details – saved profile")
        infoBar.buttons["BackButton"].tap()

        XCTAssertTrue(firstChat.waitForExistence(timeout: 5))
        let descriptionY = description.frame.midY
        let listInput = app.textViews["homeMessageInput"]
        let listAttachment = app.buttons["addAttachment"]
        XCTAssertEqual(listInput.frame.midY, listAttachment.frame.midY, accuracy: 3)
        listInput.tap()
        let listKeyboard = app.keyboards.firstMatch
        XCTAssertTrue(listKeyboard.waitForExistence(timeout: 5))
        XCTAssertTrue(firstChat.waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Chats"].exists)
        XCTAssertTrue(description.isHittable)
        XCTAssertEqual(description.frame.midY, descriptionY, accuracy: 5)
        XCTAssertLessThanOrEqual(listInput.frame.maxY, listAttachment.frame.minY)
        attachScreenshot(app, name: "Mate – profile while composing")
        let blankY = (description.frame.maxY + listInput.frame.minY) / 2
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width / 2, dy: blankY - app.frame.minY)).tap()
        XCTAssertTrue(listKeyboard.waitForNonExistence(timeout: 5))
        XCTAssertTrue(firstChat.waitForExistence(timeout: 5))
        firstChat.tap()
        let header = app.descendants(matching: .any).matching(identifier: "mateConversationHeader").firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        XCTAssertEqual(header.label, "Fixture Mate")
        XCTAssertEqual(header.frame.midX, app.frame.midX, accuracy: 3)
        let bar = app.navigationBars["Fixture Mate"]
        XCTAssertTrue(bar.exists)
        XCTAssertGreaterThan(header.frame.height, 84)
        XCTAssertGreaterThan(header.frame.maxY, bar.frame.maxY + 20)
        XCTAssertTrue(app.buttons["newConversation"].exists)
        XCTAssertTrue(app.buttons["conversationOptions"].exists)
        let prompt = app.staticTexts["Check whether the build is ready."]
        XCTAssertTrue(prompt.waitForExistence(timeout: 5))
        let transcript = app.scrollViews.firstMatch
        for _ in 0..<4 {
            if prompt.frame.minY > header.frame.maxY { break }
            transcript.swipeDown()
        }
        XCTAssertGreaterThan(prompt.frame.minY, header.frame.maxY)
        XCTAssertTrue(app.staticTexts["The release checklist is ready."].exists)
        XCTAssertTrue(app.staticTexts["Signing is still pending."].exists)
        XCTAssertFalse(app.staticTexts["Temporary build note."].exists)
        XCTAssertFalse(app.buttons["turnFile-91-src/Mate.swift"].exists)
        XCTAssertFalse(app.staticTexts["Edited 1 file"].exists)
        XCTAssertTrue(app.staticTexts["Which release audience should we use?"].exists)
        XCTAssertTrue(app.staticTexts["Internal testing"].exists)
        XCTAssertFalse(app.staticTexts["External testing"].exists)
        XCTAssertTrue(app.staticTexts["When should we distribute the build?"].exists)
        XCTAssertTrue(app.staticTexts["Today"].exists)
        XCTAssertTrue(app.staticTexts["Tomorrow"].exists)
        XCTAssertTrue(app.staticTexts["After signing completes."].exists)
        XCTAssertFalse(app.buttons["toolCall-2"].exists)
        XCTAssertFalse(app.buttons["copyAnswer"].exists)
        attachScreenshot(app, name: "Mate chat – centered header")

        app.buttons["conversationOptions"].tap()
        let outputs = app.buttons["conversationOutputs"]
        XCTAssertTrue(outputs.waitForExistence(timeout: 5))
        outputs.tap()
        XCTAssertTrue(app.navigationBars["Outputs"].waitForExistence(timeout: 5))
        app.buttons["closeComposerSheet"].tap()

        let initialPromptY = prompt.frame.minY
        let start = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.83, dy: 0.54))
        let end = start.withOffset(CGVector(dx: 0, dy: -107))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.25)
        XCTAssertLessThan(prompt.frame.minY, initialPromptY - 40)
        attachScreenshot(app, name: "Mate chat – messages beneath header")

        let input = app.textViews.firstMatch
        let send = app.buttons["Send message"]
        let addAttachment = app.buttons["Add attachment"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.frame.midY, addAttachment.frame.midY, accuracy: 3)
        XCTAssertEqual(input.frame.midY, send.frame.midY, accuracy: 3)
        let compactWidth = input.frame.width
        input.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            input.frame.maxY <= addAttachment.frame.minY && input.frame.width > compactWidth
        }, object: input)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 3), .completed)
        XCTAssertEqual(input.value as? String, "")
        attachScreenshot(app, name: "Mate composer – expanded on focus")

        input.typeText("A")
        XCTAssertTrue(keyboard.exists)
        XCTAssertEqual(addAttachment.frame.midY, send.frame.midY, accuracy: 3)
        input.typeText("\nSecond line")
        XCTAssertEqual(input.value as? String, "A\nSecond line")
        XCTAssertLessThan(send.frame.maxY, keyboard.frame.minY)
        attachScreenshot(app, name: "Mate composer – expanded while typing")

        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "A\nSecond line".count))
        XCTAssertTrue(keyboard.exists)
        XCTAssertEqual(input.value as? String, "")
        XCTAssertLessThanOrEqual(input.frame.maxY, addAttachment.frame.minY)

        input.typeText("Take your time")
        send.tap()
        let allow = app.buttons["allowDataSharing"]
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        let thinking = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Thinking")).firstMatch
        XCTAssertTrue(thinking.waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Mate chat – avatar while thinking")
        XCTAssertTrue(thinking.waitForNonExistence(timeout: 10))
        let stop = app.buttons["Stop reply"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        attachScreenshot(app, name: "Mate composer – avatar-tinted stop button")
        stop.tap()
        XCTAssertTrue(send.waitForExistence(timeout: 10))

        app.navigationBars.buttons["BackButton"].tap()
        XCTAssertTrue(app.staticTexts["Release check 1"].waitForExistence(timeout: 5))
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateInfoShowsBasicProfileWhenTheComputerOmitsDetails() {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-solo"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        if !mate.isHittable { app.swipeUp() }
        mate.tap()

        let info = app.buttons["openMateInfo"]
        XCTAssertTrue(info.waitForExistence(timeout: 5))
        info.tap()
        XCTAssertTrue(app.staticTexts["Fixture Solo"].waitForExistence(timeout: 5))
        XCTAssertTrue(mateInfoRow(containing: "No team", in: app).exists)
        XCTAssertTrue(mateInfoRow(containing: "Model", in: app).exists)
        XCTAssertFalse(app.staticTexts["Instructions"].exists)
        app.buttons["mateInfoTab-Memory"].tap()
        XCTAssertTrue(mateInfoRow(containing: "Update Mains on your computer", in: app).waitForExistence(timeout: 5))
        app.navigationBars["Mate Details"].buttons["BackButton"].tap()
        app.navigationBars["Fixture Solo"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateDetailsPinsTabsAndCondensesTheProfileTitle() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-mate-scroll")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        let info = app.buttons["openMateInfo"]
        XCTAssertTrue(info.waitForExistence(timeout: 5))
        info.tap()

        let expandedBar = app.navigationBars["Mate Details"]
        let compactBar = app.navigationBars["Fixture Mate"]
        let scroll = app.scrollViews["mateInfoScroll"]
        let tabs = app.descendants(matching: .any)["mateInfoTabs"].firstMatch
        let profileName = app.staticTexts["mateInfoName"]
        XCTAssertTrue(profileName.waitForExistence(timeout: 5))
        XCTAssertTrue(expandedBar.staticTexts["Mate Details"].exists)
        let originalY = tabs.frame.minY
        scroll.swipeUp()
        XCTAssertTrue(compactBar.staticTexts["Fixture Mate"].waitForExistence(timeout: 5))
        let pinnedY = tabs.frame.minY
        XCTAssertLessThan(pinnedY, originalY)
        XCTAssertEqual(pinnedY, compactBar.frame.maxY, accuracy: 6)
        XCTAssertFalse(profileName.isHittable)
        scroll.swipeUp()
        XCTAssertEqual(tabs.frame.minY, pinnedY, accuracy: 2)
        attachScreenshot(app, name: "Mate Details – pinned tabs and fade")

        app.buttons["mateInfoTab-Memory"].tap()
        let newMemory = app.buttons["New Memory"]
        XCTAssertTrue(newMemory.waitForExistence(timeout: 5))
        XCTAssertTrue(newMemory.isHittable)
        XCTAssertTrue(compactBar.staticTexts["Fixture Mate"].exists)
        XCTAssertEqual(tabs.frame.minY, pinnedY, accuracy: 2)
        scroll.swipeDown()
        XCTAssertTrue(expandedBar.staticTexts["Mate Details"].waitForExistence(timeout: 5))
        XCTAssertTrue(profileName.isHittable)
        XCTAssertEqual(tabs.frame.minY, originalY, accuracy: 4)

        expandedBar.buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateDetailsEditsFromTheHeaderAndConfirmsArchive() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-mate-info")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        app.buttons["openMateInfo"].tap()

        let details = app.navigationBars["Mate Details"]
        let edit = details.buttons["editMateProfile"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(edit.frame.midX, details.frame.midX)
        edit.tap()
        let editor = app.navigationBars["Edit Profile"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.buttons["Cancel"].tap()
        XCTAssertTrue(editor.waitForNonExistence(timeout: 5))

        let archive = app.buttons["archiveMateFromDetails"]
        scrollTo(archive, in: app)
        attachScreenshot(app, name: "Mate Details – archive button")
        let confirmation = app.alerts["Archive Fixture Mate?"]
        archive.tap()
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        XCTAssertEqual(confirmation.frame.midY, app.frame.midY, accuracy: 36)
        attachScreenshot(app, name: "Mate Details – archive confirmation")
        confirmation.buttons["Cancel"].tap()
        XCTAssertTrue(confirmation.waitForNonExistence(timeout: 5))
        XCTAssertTrue(archive.isEnabled)
        archive.tap()
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.buttons["Archive"].tap()

        XCTAssertTrue(app.buttons["Restore Mate"].waitForExistence(timeout: 5))
        XCTAssertFalse(archive.exists)
        XCTAssertFalse(app.navigationBars.buttons["editMateProfile"].exists)
        let url = URL(string: "http://127.0.0.1:18787/observations")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let writes = calls.filter { $0["channel"] as? String == "assistants:mobileManage" }
        XCTAssertEqual(writes.count, 1)
        let arguments = try XCTUnwrap(writes.first?["args"] as? [Any])
        XCTAssertEqual(arguments[1] as? String, "fixture-mate")
        let change = try XCTUnwrap(arguments[2] as? [String: Any])
        XCTAssertEqual(change["action"] as? String, "archive")
        XCTAssertEqual(change["archived"] as? Bool, true)

        app.navigationBars.buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testEditMateSavesModelAndEffortFromTheSameScreen() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-mate-info")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        app.buttons["openMateInfo"].tap()
        let edit = app.navigationBars.buttons["editMateProfile"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()

        let editor = app.navigationBars["Edit Profile"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        let name = app.textFields["editMateName"]
        XCTAssertTrue(name.exists)
        let scrollEdge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.025, dy: 0.58))
        let distanceToHeader = name.frame.midY - editor.frame.midY
        scrollEdge.press(forDuration: 0.05, thenDragTo: scrollEdge.withOffset(CGVector(dx: 0, dy: -distanceToHeader)),
                         withVelocity: .slow, thenHoldForDuration: 0.25)
        XCTAssertLessThan(name.frame.minY, editor.frame.maxY)
        XCTAssertGreaterThan(name.frame.maxY, editor.frame.minY)
        attachScreenshot(app, name: "Edit Profile – protected header while scrolling")
        scrollEdge.press(forDuration: 0.05, thenDragTo: scrollEdge.withOffset(CGVector(dx: 0, dy: distanceToHeader + 100)),
                         withVelocity: .slow, thenHoldForDuration: 0.25)
        let keyboard = app.keyboards.firstMatch
        func tapOutside(_ field: XCUIElement) {
            app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: 8, dy: field.frame.midY - app.frame.minY)).tap()
        }
        name.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        tapOutside(name)
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        let save = editor.buttons["Save"]
        XCTAssertFalse(save.isEnabled)
        let model = app.descendants(matching: .any).matching(identifier: "selectModel").firstMatch
        scrollTo(model, in: app)
        XCTAssertEqual(model.value as? String, "Balanced")
        chooseModel("fixture-deep", in: app)
        let slider = app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch
        scrollTo(slider, in: app)
        selectEffort(at: 0, in: app)
        XCTAssertEqual(slider.value as? String, "Medium")
        XCTAssertTrue(save.isEnabled)
        attachScreenshot(app, name: "Edit Profile – model and effort")
        let description = app.descendants(matching: .any).matching(identifier: "editMateDescription").firstMatch
        scrollTo(description, in: app)
        XCTAssertTrue(app.textViews["editMateInstructions"].exists)
        attachScreenshot(app, name: "Edit Profile – description and instructions")
        description.tap()
        description.typeText(" and signing")
        let editedDescription = try XCTUnwrap(description.value as? String).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertTrue(editedDescription.contains("and signing"))
        XCTAssertTrue(keyboard.exists)
        tapOutside(description)
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        XCTAssertEqual((description.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), editedDescription)
        save.tap()
        XCTAssertTrue(editor.waitForNonExistence(timeout: 5))
        XCTAssertTrue(mateInfoRow(containing: "Deep Thinker", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(mateInfoRow(containing: "Medium", in: app).exists)

        let url = URL(string: "http://127.0.0.1:18787/observations")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let writes = calls.filter { $0["channel"] as? String == "assistants:mobileManage" }
        XCTAssertEqual(writes.count, 1)
        let args = try XCTUnwrap(writes.first?["args"] as? [Any])
        let change = try XCTUnwrap(args[2] as? [String: Any])
        XCTAssertEqual((change["profile"] as? [String: Any])?["description"] as? String, editedDescription)
        XCTAssertEqual(change["modelChange"] as? [String: String], [
            "model": "fixture-deep", "effort": "medium", "expectedModel": "fixture-balanced", "expectedEffort": "high",
        ])

        app.navigationBars.buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateScreensAndTabsShareLoadingAndKeepLoadedContent() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-mate-info")

        func hold(_ path: String, delays: [String: Int]) async throws {
            var request = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/\(path)")!)
            request.httpMethod = "POST"
            request.httpBody = try JSONEncoder().encode(delays)
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }

        let loader = app.descendants(matching: .any).matching(identifier: "contentLoading").firstMatch
        func checkLoader(_ title: String) {
            XCTAssertTrue(loader.waitForExistence(timeout: 3))
            XCTAssertEqual(loader.label, title)
            XCTAssertEqual(loader.frame.midX, app.frame.midX, accuracy: 2)
            attachScreenshot(app, name: title)
        }

        try await hold("hold-mate-loads", delays: ["directoryMs": 4500, "routinesMs": 4500])
        app.buttons["openMates"].tap()
        checkLoader("Loading Mates…")
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 8))
        mate.tap()

        let info = app.buttons["openMateInfo"]
        XCTAssertTrue(info.waitForExistence(timeout: 5))
        try await hold("hold-mate-details", delays: ["durationMs": 4500])
        info.tap()
        checkLoader("Loading Mate details…")
        XCTAssertTrue(app.staticTexts["mateInfoName"].waitForExistence(timeout: 8))

        let routines = app.buttons["mateInfoTab-Routines"]
        routines.tap()
        checkLoader("Loading routines…")
        let routine = app.staticTexts["Morning release check"]
        XCTAssertTrue(routine.waitForExistence(timeout: 8))
        app.buttons["mateInfoTab-Details"].tap()
        XCTAssertFalse(routine.exists)
        routines.tap()
        XCTAssertTrue(routine.exists)
        XCTAssertFalse(loader.exists)

        app.navigationBars["Mate Details"].buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateInfoTabsReadAndManageThePairedMate() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-mate-info")
        app.buttons["openMates"].tap()
        let openArchive = app.buttons["openArchivedMates"]
        XCTAssertTrue(openArchive.waitForExistence(timeout: 5))
        openArchive.tap()
        let archiveBar = app.navigationBars["Archived Mates"]
        XCTAssertTrue(archiveBar.waitForExistence(timeout: 5))
        let closeArchive = archiveBar.buttons["closeArchivedMates"]
        XCTAssertTrue(closeArchive.exists)
        XCTAssertGreaterThan(closeArchive.frame.midX, archiveBar.frame.midX)
        let archivedMate = app.buttons["mate-fixture-retired-mate"]
        XCTAssertTrue(archivedMate.waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Archived Mates – full screen")
        closeArchive.tap()
        XCTAssertTrue(archiveBar.waitForNonExistence(timeout: 5))

        openArchive.tap()
        XCTAssertTrue(archivedMate.waitForExistence(timeout: 5))
        archivedMate.tap()
        let archivedChat = app.staticTexts["Archived release check"]
        XCTAssertTrue(archivedChat.waitForExistence(timeout: 5))
        XCTAssertFalse(app.textViews["homeMessageInput"].exists)
        let archivedBar = app.navigationBars["Retired Release Mate"]
        let archivedInfo = archivedBar.buttons["openMateInfo"]
        XCTAssertGreaterThan(archivedBar.buttons["closeArchivedMates"].frame.midX, archivedInfo.frame.midX)
        archivedInfo.tap()
        let detailsBar = app.navigationBars["Mate Details"]
        XCTAssertTrue(detailsBar.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Restore Mate"].waitForExistence(timeout: 5))
        XCTAssertTrue(detailsBar.buttons["closeArchivedMates"].exists)
        detailsBar.buttons["BackButton"].tap()
        archivedChat.tap()
        XCTAssertTrue(app.staticTexts["Archived release checklist."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["restoreMateFromConversation"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()

        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        let info = app.buttons["openMateInfo"]
        XCTAssertTrue(info.waitForExistence(timeout: 5))
        info.tap()
        let name = app.staticTexts["mateInfoName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertEqual(name.label, "Fixture Mate")
        XCTAssertTrue(detailsBar.staticTexts["Mate Details"].exists)
        XCTAssertTrue(app.buttons["Archive Mate"].exists)
        XCTAssertFalse(app.buttons["mateInfoTab-Chats"].exists)
        attachScreenshot(app, name: "Mate Details – profile")

        app.buttons["mateInfoTab-Memory"].tap()
        let addMemory = app.buttons["New Memory"]
        XCTAssertTrue(addMemory.waitForExistence(timeout: 5))
        addMemory.tap()
        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let pinned = app.switches["Pinned"]
        let shared = app.switches["Share with team"]
        assertControl(pinned, value: "0")
        assertControl(shared, value: "1")
        attachScreenshot(app, name: "New Memory – default switches")
        let switchPosition = CGVector(dx: 0.94, dy: 0.5)
        pinned.coordinate(withNormalizedOffset: switchPosition).tap()
        assertControl(pinned, value: "1")
        shared.coordinate(withNormalizedOffset: switchPosition).tap()
        assertControl(shared, value: "0")
        attachScreenshot(app, name: "New Memory – toggled switches")
        title.tap()
        title.typeText("QA release note")
        let note = app.textViews["mateMemoryText"]
        note.tap()
        note.typeText("Remember final checks.")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["QA release note"].waitForExistence(timeout: 5))

        app.buttons["mateInfoTab-Assignments"].tap()
        let assignment = app.staticTexts["Release handoff"]
        XCTAssertTrue(assignment.waitForExistence(timeout: 5))
        assignment.tap()
        XCTAssertTrue(app.buttons["Open Chat"].waitForExistence(timeout: 5))
        let assignmentBar = app.navigationBars["Assignment"]
        let closeAssignment = assignmentBar.buttons["closeMateAssignment"]
        XCTAssertTrue(closeAssignment.exists)
        XCTAssertLessThan(closeAssignment.frame.midX, assignmentBar.frame.midX)
        attachScreenshot(app, name: "Mate Details – Assignment")
        closeAssignment.tap()
        XCTAssertTrue(assignmentBar.waitForNonExistence(timeout: 5))

        let routines = app.buttons["mateInfoTab-Routines"]
        if !routines.isHittable { app.descendants(matching: .any)["mateInfoTabs"].firstMatch.swipeLeft() }
        routines.tap()
        XCTAssertTrue(app.staticTexts["Morning release check"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Paused"].exists)
        attachScreenshot(app, name: "Mate Details – Routines")

        detailsBar.buttons["BackButton"].tap()
        XCTAssertTrue(app.textViews["homeMessageInput"].waitForExistence(timeout: 5))
        let chat = app.staticTexts["Release check 1"]
        XCTAssertTrue(chat.waitForExistence(timeout: 5))
        chat.tap()
        XCTAssertTrue(app.staticTexts["Check whether the build is ready."].waitForExistence(timeout: 10))
        app.navigationBars.buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateDirectorySearchAndLiveActivity() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-mate-info")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        let reviewer = app.buttons["mate-fixture-reviewer"]
        let planner = app.buttons["mate-fixture-planner"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        XCTAssertFalse(mate.label.contains("Working"))

        func changeActivity(_ phase: String) async throws {
            var request = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/mate-activity")!)
            request.httpMethod = "POST"
            request.httpBody = try JSONEncoder().encode(["phase": phase])
            _ = try await URLSession.shared.data(for: request)
        }
        func waitForLabel(_ label: String, on row: XCUIElement, present: Bool) async {
            let predicate = NSPredicate(format: present ? "label CONTAINS %@" : "NOT (label CONTAINS %@)", label)
            let result = await XCTWaiter.fulfillment(of: [XCTNSPredicateExpectation(predicate: predicate, object: row)], timeout: 5)
            XCTAssertEqual(result, .completed)
        }

        try await changeActivity("start")
        await waitForLabel("Working", on: mate, present: true)
        await waitForLabel("Needs you", on: planner, present: true)
        attachScreenshot(app, name: "Mates – live status")
        try await changeActivity("finish")
        await waitForLabel("Working", on: mate, present: false)
        await waitForLabel("Needs you", on: planner, present: false)

        func beginSearch(_ prompt: String) -> XCUIElement {
            let field = app.searchFields[prompt]
            if !field.isHittable { app.buttons["Search"].tap() }
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            field.tap()
            return field
        }
        func replaceSearch(_ text: String, in field: XCUIElement) {
            if let value = field.value as? String, value != field.placeholderValue {
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
            }
            field.typeText(text)
        }
        func closeSearch() {
            let close = app.buttons["close"]
            if close.exists { close.tap() }
            else { app.buttons["Cancel"].tap() }
        }

        let search = beginSearch("Search Mates")
        replaceSearch("PLANS TRIPS", in: search)
        XCTAssertTrue(mate.waitForNonExistence(timeout: 5))
        XCTAssertTrue(planner.exists)
        XCTAssertTrue(app.staticTexts["Planning Team"].exists)
        replaceSearch("release team", in: search)
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        XCTAssertTrue(reviewer.exists)
        XCTAssertFalse(planner.exists)
        attachScreenshot(app, name: "Mates – search by team")
        closeSearch()

        app.buttons["openArchivedMates"].tap()
        let retired = app.buttons["mate-fixture-retired-mate"]
        XCTAssertTrue(retired.waitForExistence(timeout: 5))
        let archivedSearch = beginSearch("Search archived Mates")
        replaceSearch("no such mate", in: archivedSearch)
        XCTAssertTrue(app.staticTexts["No matching Mates"].waitForExistence(timeout: 5))
        XCTAssertFalse(retired.exists)
        replaceSearch("retired", in: archivedSearch)
        XCTAssertTrue(retired.waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Archived Mates – search by name")
        closeSearch()
        app.navigationBars["Archived Mates"].buttons["closeArchivedMates"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testCreatesTeamsFromNewMateAndEditProfile() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-mate-team")
        app.buttons["openMates"].tap()
        let newMate = app.buttons["newMate"]
        XCTAssertTrue(newMate.waitForExistence(timeout: 5))
        newMate.tap()
        let name = app.textFields["mateName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Team Mate\n")

        let teams = app.buttons["mateTeamPicker"]
        let field = app.textFields["mateTeamName"]
        let submit = app.buttons["submitMateTeam"]
        func beginTeam(_ name: String) {
            scrollTo(teams, in: app)
            teams.tap()
            app.buttons["New Team"].tap()
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            XCTAssertFalse(submit.isEnabled)
            let keyboard = app.keyboards.firstMatch
            if !keyboard.exists { field.tap() }
            XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
            field.typeText(name)
            submit.tap()
        }

        XCTAssertEqual(teams.value as? String, "No team")
        beginTeam("Launch Team")
        let check = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Check"), object: submit)
        let received = await XCTWaiter.fulfillment(of: [check], timeout: 5)
        XCTAssertEqual(received, .completed)
        XCTAssertEqual(field.value as? String, "Launch Team")
        submit.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        XCTAssertEqual(teams.value as? String, "Launch Team")
        XCTAssertEqual(name.value as? String, "Team Mate")
        app.buttons["nextMateStep"].tap()
        let create = app.buttons["createMate"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()
        let createdBar = app.navigationBars["Team Mate"]
        XCTAssertTrue(createdBar.waitForExistence(timeout: 10))
        createdBar.buttons["BackButton"].tap()
        XCTAssertTrue(app.staticTexts["Launch Team"].waitForExistence(timeout: 5))

        let existingMate = app.buttons["mate-fixture-mate"]
        scrollTo(existingMate, in: app)
        existingMate.tap()
        let info = app.buttons["openMateInfo"]
        XCTAssertTrue(info.waitForExistence(timeout: 5))
        info.tap()
        let edit = app.buttons["Edit Profile"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        scrollTo(edit, in: app)
        edit.tap()
        XCTAssertTrue(app.navigationBars["Edit Profile"].waitForExistence(timeout: 5))
        beginTeam("Review Team")
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        XCTAssertEqual(teams.value as? String, "Review Team")
        let url = URL(string: "http://127.0.0.1:18787/observations")!
        func calls() async throws -> [[String: Any]] {
            let (data, _) = try await URLSession.shared.data(from: url)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        }
        let beforeSave = try await calls()
        let teamCommands = beforeSave.filter { $0["channel"] as? String == "assistants:createTeam" }
        XCTAssertEqual(teamCommands.count, 3)
        XCTAssertEqual(teamCommands[0]["commandId"] as? String, teamCommands[1]["commandId"] as? String)
        XCTAssertFalse(beforeSave.contains { $0["channel"] as? String == "assistants:mobileManage" })
        app.navigationBars["Edit Profile"].buttons["Save"].tap()
        XCTAssertTrue(mateInfoRow(containing: "Review Team", in: app).waitForExistence(timeout: 5))

        app.navigationBars["Mate Details"].buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        XCTAssertTrue(app.staticTexts["Review Team"].waitForExistence(timeout: 5))
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testMateExecutionAsksForTheWorkersProviderConsent() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-mate-consent")
        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        let info = app.buttons["openMateInfo"]
        XCTAssertTrue(info.waitForExistence(timeout: 5))
        info.tap()

        func selectTab(_ name: String) {
            let tab = app.buttons["mateInfoTab-" + name]
            if !tab.isHittable { app.scrollViews["mateInfoTabs"].swipeLeft() }
            tab.tap()
        }
        func writes() async throws -> [[String: Any]] {
            let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
            let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
            return calls.filter { $0["channel"] as? String == "assistants:mobileManage" }
                .compactMap { ($0["args"] as? [Any])?.dropFirst(2).first as? [String: Any] }
        }

        selectTab("Assignments")
        let newAssignment = app.buttons["New Assignment"]
        XCTAssertTrue(newAssignment.waitForExistence(timeout: 5))
        newAssignment.tap()
        let form = app.navigationBars["New Assignment"]
        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap(); title.typeText("Check the release")
        let message = app.textViews["Task message"]
        message.tap(); message.typeText("Review the sample.")
        form.buttons["Assign"].tap()
        let openAI = app.staticTexts["Share data with OpenAI?"]
        XCTAssertTrue(openAI.waitForExistence(timeout: 5))
        app.buttons["declineDataSharing"].tap()
        XCTAssertTrue(openAI.waitForNonExistence(timeout: 5))
        XCTAssertEqual(title.value as? String, "Check the release")
        XCTAssertEqual(message.value as? String, "Review the sample.")
        let declined = try await writes()
        XCTAssertTrue(declined.isEmpty)

        form.buttons["Assign"].tap()
        XCTAssertTrue(openAI.waitForExistence(timeout: 5))
        app.buttons["allowDataSharing"].tap()
        XCTAssertTrue(form.waitForNonExistence(timeout: 5))

        let blocked = app.staticTexts["Needs report details"]
        XCTAssertTrue(blocked.waitForExistence(timeout: 5))
        blocked.tap()
        let followup = app.buttons["Follow Up"]
        XCTAssertTrue(followup.waitForExistence(timeout: 5))
        if !followup.isHittable { app.swipeUp() }
        followup.tap()
        let followupForm = app.navigationBars["Follow Up"]
        XCTAssertTrue(followupForm.waitForExistence(timeout: 5))
        message.tap(); message.typeText("Use the updated sample.")
        followupForm.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["Share data with Anthropic?"].waitForExistence(timeout: 5))
        let beforeFollowup = try await writes()
        XCTAssertEqual(beforeFollowup.compactMap { $0["action"] as? String }, ["assign"])
        app.buttons["allowDataSharing"].tap()
        XCTAssertTrue(followupForm.waitForNonExistence(timeout: 5))
        app.buttons["closeMateAssignment"].tap()

        selectTab("Routines")
        let routineActions = app.buttons["Routine Actions"]
        XCTAssertTrue(routineActions.waitForExistence(timeout: 5))
        routineActions.tap()
        app.buttons["Run Now"].tap()
        var submitted = try await writes()
        for _ in 0..<25 where submitted.count < 3 {
            try await Task.sleep(for: .milliseconds(100))
            submitted = try await writes()
        }
        XCTAssertEqual(submitted.compactMap { $0["action"] as? String }, ["assign", "followup", "runRoutine"])
        XCTAssertEqual(submitted.first(where: { $0["action"] as? String == "followup" })?["message"] as? String, "Use the updated sample.")
        XCTAssertFalse(app.buttons["allowDataSharing"].exists)

        app.navigationBars["Mate Details"].buttons["BackButton"].tap()
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        app.navigationBars["Mates"].buttons["BackButton"].tap()
        forgetFixture(app)
    }

    private func mateInfoRow(containing text: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@ OR value == %@", text, text)).firstMatch
    }

    func testMateAvatarPreviewRotatesAndCreationCarouselSwitchesStyles() throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        let preview = app.descendants(matching: .any).matching(identifier: "mate-robot-preview").firstMatch
        let root = app.coordinate(withNormalizedOffset: .zero)

        func drag(from point: CGPoint, dx: CGFloat = 0, dy: CGFloat = 0) {
            root.withOffset(CGVector(dx: point.x, dy: point.y)).press(forDuration: 0.05, thenDragTo:
                root.withOffset(CGVector(dx: point.x + dx, dy: point.y + dy)))
        }

        func checkPreview(in title: String) {
            XCTAssertTrue(preview.waitForExistence(timeout: 15))
            let position = preview.frame
            let center = CGPoint(x: position.midX, y: position.midY)
            let original = preview.screenshot().pngRepresentation
            drag(from: center, dx: 135)
            XCTAssertTrue(app.navigationBars[title].exists)
            XCTAssertNotEqual(preview.screenshot().pngRepresentation, original)
            drag(from: center, dy: -130)
            XCTAssertTrue(app.navigationBars[title].exists)
            XCTAssertEqual(preview.frame.minY, position.minY, accuracy: 3)
        }

        app.buttons["openMates"].tap()
        let mate = app.buttons["mate-fixture-mate"]
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        mate.tap()
        checkPreview(in: "Fixture Mate")

        let initialY = preview.frame.minY
        drag(from: CGPoint(x: app.frame.maxX - 38, y: app.frame.midY + 140), dy: -180)
        XCTAssertTrue(!preview.exists || preview.frame.minY < initialY - 20)
        app.navigationBars["Fixture Mate"].buttons["BackButton"].tap()
        XCTAssertTrue(mate.waitForExistence(timeout: 5))

        app.buttons["newMate"].tap()
        let carousel = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "mate-avatar-carousel")).firstMatch
        func checkAvatar(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
            let expected = NSPredicate(format: "value == %@ AND identifier == %@", label, "mate-avatar-carousel-3d")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: expected, object: carousel)], timeout: 10),
                           .completed, file: file, line: line)
        }
        XCTAssertTrue(carousel.waitForExistence(timeout: 5))
        checkAvatar("Amber")
        let midpoint = CGPoint(x: app.frame.midX, y: carousel.frame.midY)
        let pose = carousel.screenshot().pngRepresentation
        root.withOffset(CGVector(dx: midpoint.x, dy: midpoint.y)).tap()
        XCTAssertNotEqual(carousel.screenshot().pngRepresentation, pose)
        checkAvatar("Amber")
        drag(from: midpoint, dx: -145)
        checkAvatar("Teal")
        let beforeManualRotation = carousel.screenshot().pngRepresentation
        root.withOffset(CGVector(dx: midpoint.x, dy: midpoint.y)).press(forDuration: 0.4, thenDragTo:
            root.withOffset(CGVector(dx: midpoint.x + 100, dy: midpoint.y - 30)))
        checkAvatar("Teal")
        XCTAssertNotEqual(carousel.screenshot().pngRepresentation, beforeManualRotation)
        drag(from: midpoint, dx: 145)
        checkAvatar("Amber")
        drag(from: midpoint, dx: 145)
        checkAvatar("Frost")

        app.buttons["mate-avatar-style-clear"].tap()
        checkAvatar("Violet Drop")
        attachScreenshot(app, name: "New Mate – Clear Shell")
        app.buttons["mate-avatar-style-metal"].tap()
        checkAvatar("Silver")
        attachScreenshot(app, name: "New Mate – One-Eye Metal")
        app.buttons["mate-avatar-style-terminal"].tap()
        checkAvatar("Frost")

        app.navigationBars["New Mate"].buttons["BackButton"].tap()
        XCTAssertTrue(mate.waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        forgetFixture(app)
    }

    func testWorkInboxShowsAllProvidersOpensRequestsAndStopsBackgroundWork() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/inbox")!)
        request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
        let inbox = app.buttons["openWorkInbox"]
        XCTAssertTrue(inbox.waitForExistence(timeout: 5)); inbox.tap()
        let waiting = app.buttons["inboxRun-inbox-waiting"]
        XCTAssertTrue(waiting.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["inboxRun-inbox-running"].exists)
        XCTAssertTrue(app.buttons["inboxRun-inbox-failed"].exists)
        XCTAssertTrue(app.buttons["inboxRun-inbox-finished"].exists)
        XCTAssertTrue(app.staticTexts["Today"].exists || app.staticTexts["Yesterday"].exists)
        attachScreenshot(app, name: "Activity – requests and work across providers")
        waiting.tap()
        XCTAssertTrue(app.buttons["approvalDeny"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Run the deployment checks?"].exists)
        app.buttons["approvalDeny"].tap()
        XCTAssertTrue(app.buttons["approvalDeny"].waitForNonExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["inboxStop-inbox-running"].waitForExistence(timeout: 10))
        app.buttons["inboxStop-inbox-running"].tap()
        XCTAssertTrue(app.buttons["inboxStop-inbox-running"].waitForNonExistence(timeout: 10))
        let stopped = app.buttons["inboxRun-inbox-running"]
        XCTAssertTrue(stopped.waitForExistence(timeout: 5))
        XCTAssertTrue(stopped.label.contains("Stopped"))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let abort = try XCTUnwrap(calls.last { $0["channel"] as? String == "runs:abort" })
        XCTAssertEqual(abort["args"] as? [String], ["inbox-running"])
        XCTAssertNotNil(abort["commandId"] as? String)
        // Return to the home shell before using the shared fixture cleanup.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        forgetFixture(app)
    }

    func testWorkInboxShowsSavedActivityAndOpensSettingsWhenDisconnected() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test")
        var inbox = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/inbox")!)
        inbox.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: inbox)
        app.buttons["openWorkInbox"].tap()
        let savedRun = app.buttons["inboxRun-inbox-failed"]
        XCTAssertTrue(savedRun.waitForExistence(timeout: 10))

        var offline = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/offline")!)
        offline.httpMethod = "POST"
        offline.httpBody = Data(#"{"durationMs":12000}"#.utf8)
        _ = try await URLSession.shared.data(for: offline)

        let title = app.staticTexts["Computer disconnected"]
        let settings = app.buttons["Connection settings"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Showing saved activity. Connect for updates."].exists)
        XCTAssertTrue(settings.isHittable)
        XCTAssertEqual(title.frame.midX, app.frame.midX, accuracy: 2)
        XCTAssertEqual(settings.frame.midX, title.frame.midX, accuracy: 2)
        XCTAssertTrue(savedRun.exists)
        attachScreenshot(app, name: "Activity disconnected with saved work")
        settings.tap()
        XCTAssertTrue(app.staticTexts["settingsConnectionStatus"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 24))
        XCTAssertTrue(savedRun.exists)
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    #if MAINS_GPT_LIVE
    func testVoiceDefaultsToFocusAndSwitchesToConversationWithoutEndingOrMuting() throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
        app.launchArguments = ["--voice-preview", "--voice-preview-light"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "voiceFocusStage").firstMatch.waitForExistence(timeout: 15))
        attachScreenshot(app, name: "GPT Live – water in light appearance")
        app.buttons["endVoice"].tap()
    }

    func testWaterVoiceStaysStaticWithReduceMotion() async throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
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

    func testMissingWorkspaceExplainsVoiceStartAndOpensPicker() throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test")
        app.buttons["sidebarMode-developer"].tap()
        app.buttons["closeSidebar"].tap()

        let startVoice = app.buttons["startVoice"]
        let notice = app.staticTexts["Workspace required"]
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("Choose a workspace"))
        XCTAssertTrue(startVoice.waitForExistence(timeout: 5))
        XCTAssertTrue(startVoice.isEnabled)
        startVoice.tap()
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["allowDataSharing"].exists)
        XCTAssertFalse(app.buttons["endVoice"].exists)

        app.buttons["chooseRequiredWorkspace"].tap()
        _ = targetWheel("docs", in: app)
        confirmTarget(in: app)
        XCTAssertTrue(notice.waitForNonExistence(timeout: 5))
        startVoice.tap()
        XCTAssertTrue(app.staticTexts["Your microphone audio during the call"].waitForExistence(timeout: 5))
        app.buttons["declineDataSharing"].tap()
        forgetFixture(app)
    }

    #endif

    func testTranscriptPagesAutomaticallyAndKeepsReadingPositionDuringRefresh() async throws {
        try await assertAutomaticTranscriptPaging(code: "ios-test-paging")
    }

    func testTranscriptPagesAcrossDisjointMobileWindows() async throws {
        try await assertAutomaticTranscriptPaging(code: "ios-test-paging-disjoint")
    }

    private func assertAutomaticTranscriptPaging(code: String) async throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
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

    func testProjectPickerCancelsAppliesAndClears() {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let target = app.buttons["chooseTarget"]
        target.tap()
        let wheel = targetWheel("No project", in: app)
        wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        _ = targetWheel("Kitchen Notes", in: app)
        let close = app.buttons["closeTargetPicker"]
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCTAssertTrue(target.label.contains("No project"))

        target.tap()
        _ = targetWheel("No project", in: app)
        wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        _ = targetWheel("Kitchen Notes", in: app)
        confirmTarget(in: app)
        XCTAssertTrue(target.label.contains("Kitchen Notes"))

        target.tap()
        _ = targetWheel("Kitchen Notes", in: app)
        attachScreenshot(app, name: "Project picker")
        wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        _ = targetWheel("No project", in: app)
        confirmTarget(in: app)
        XCTAssertTrue(target.label.contains("No project"))
        forgetFixture(app)
    }

    func testMissingWorkspaceExplainsSendAndKeepsTheDraft() throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let wheel = targetWheel("docs", in: app)
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.exists)
        XCTAssertLessThan(wheel.frame.maxY, keyboard.frame.minY)
        let start = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.25)
        _ = targetWheel("mains", in: app)
        attachScreenshot(app, name: "Workspace picker above keyboard")
        confirmTarget(in: app)
        XCTAssertTrue(keyboard.exists)
        XCTAssertEqual(input.value as? String, "Keep this request")
        send.tap()
        XCTAssertTrue(app.buttons["allowDataSharing"].waitForExistence(timeout: 5))
        app.buttons["allowDataSharing"].tap()
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
    }

    func testDemoContextPickerKeepsKeyboardAndSendsSelections() throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
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
        let app = makeApplication()
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
        let app = makeApplication()
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
        let app = makeApplication()
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
        let app = makeApplication()
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
        let app = makeApplication()
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
        let app = makeApplication()
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
        let photos = app.descendants(matching: .any).matching(identifier: "attachmentPhotosPanel").firstMatch
        XCTAssertTrue(photos.waitForExistence(timeout: 5))
        app.buttons["attachmentPanelBack"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        app.buttons["Camera"].tap()
        let camera = app.descendants(matching: .any).matching(identifier: "attachmentCameraPanel").firstMatch
        XCTAssertTrue(camera.waitForExistence(timeout: 5))
        app.buttons["closeAttachmentPanel"].tap()
        XCTAssertTrue(menu.waitForNonExistence(timeout: 5))
        forgetFixture(app)
    }

    func testAttachmentMenuKeepsKeyboardAndDraftInHomeAndConversation() throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
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

    func testSettingsChangesTheHomeScreenAppIcon() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test")
        let defaultIcon = app.buttons["appIcon-default"]
        let atlas = app.buttons["appIcon-atlas"]
        let bridge = app.buttons["appIcon-bridge"]
        let mate = app.buttons["appIcon-mate"]
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        func openIconSettings() {
            openSidebar(app)
            app.buttons["openSettings"].tap()
            scrollTo(defaultIcon, in: app)
        }

        func select(_ icon: XCUIElement) {
            let originalY = defaultIcon.frame.minY
            icon.tap()
            let confirmation = springboard.alerts.buttons["OK"].firstMatch
            if confirmation.waitForExistence(timeout: 2) { confirmation.tap() }
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: icon)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
            XCTAssertEqual(defaultIcon.frame.minY, originalY, accuracy: 1, "Changing the icon preserves the Settings scroll position.")
        }

        func connectionCount() async throws -> Int {
            let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
            let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
            return calls.count { $0["channel"] as? String == "backend:describe" }
        }

        openIconSettings()
        for icon in [atlas, bridge, mate] {
            XCTAssertTrue(icon.isHittable)
            XCTAssertEqual(icon.frame.midY, defaultIcon.frame.midY, accuracy: 1)
        }
        let connections = try await connectionCount()
        XCTAssertGreaterThan(connections, 0)
        if !defaultIcon.isSelected { select(defaultIcon) }
        select(atlas)
        select(bridge)
        select(mate)
        let connectionsAfterSelection = try await connectionCount()
        XCTAssertEqual(connectionsAfterSelection, connections, "The system icon alert should not reconnect the paired computer.")
        attachScreenshot(app, name: "Settings – App Icon choices")

        app.terminate()
        app.launch()
        openIconSettings()
        XCTAssertTrue(mate.isSelected, "The Home Screen icon persists across launches.")
        select(defaultIcon)
        forgetFixture(app)
    }

    func testSettingsAppearanceAndProviderPermissionReset() throws {
        continueAfterFailure = false
        let app = makeApplication()
        let conversation = pairFixture(app, code: "ios-test")
        conversation.tap()
        let input = app.textViews.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("Allow this fixture for the settings check")
        app.buttons["Send message"].tap()
        let allow = app.buttons["allowDataSharing"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5)); allow.tap()
        XCTAssertTrue(allow.waitForNonExistence(timeout: 5))

        app.navigationBars.buttons.element(boundBy: 0).tap()
        openSidebar(app); app.buttons["openSettings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Test Mac"].exists)
        XCTAssertTrue(app.staticTexts["Connection details"].isHittable)
        attachScreenshot(app, name: "Settings – compact groups in system appearance")
        let sync = app.buttons["syncNow"]
        XCTAssertTrue(sync.isEnabled); sync.tap()
        let system = app.buttons["appearance-system"]
        let light = app.buttons["appearance-light"]
        let dark = app.buttons["appearance-dark"]
        scrollTo(dark, in: app)
        XCTAssertTrue(system.isHittable && light.isHittable && dark.isHittable)
        XCTAssertEqual(light.frame.midY, system.frame.midY, accuracy: 1)
        XCTAssertEqual(dark.frame.midY, system.frame.midY, accuracy: 1)
        light.tap()
        XCTAssertTrue(light.isSelected)
        attachScreenshot(app, name: "Appearance – Day selected")
        dark.tap()
        XCTAssertTrue(dark.isSelected)
        XCTAssertFalse(light.isSelected)
        attachScreenshot(app, name: "Appearance – Night selected")

        let sharing = app.buttons["aiDataSharing"]
        scrollTo(sharing, in: app)
        XCTAssertTrue(app.staticTexts["inlinePageTitle"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Settings – collapsed title in dark appearance")
        app.swipeUp()
        let version = app.staticTexts["settingsAppVersion"]
        XCTAssertTrue(version.isHittable)
        XCTAssertTrue(version.label.hasPrefix("App Version "))
        let sign = app.buttons["settingsTokyoSign"]
        XCTAssertTrue(sign.isHittable)
        let firstLanguage = sign.label
        XCTAssertTrue(["Live from Tokyo", "東京から生中継"].contains(firstLanguage))
        let otherLanguage = firstLanguage == "Live from Tokyo" ? "東京から生中継" : "Live from Tokyo"
        sign.tap()
        XCTAssertEqual(sign.label, otherLanguage)

        let automaticChange = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", firstLanguage), object: sign)
        XCTAssertEqual(XCTWaiter.wait(for: [automaticChange], timeout: 6), .completed)
        attachScreenshot(app, name: "Settings – support and Tokyo sign")

        let copy = app.buttons["copyDiagnostics"]
        XCTAssertTrue(copy.isHittable); copy.tap()
        let copied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Copied"), object: copy)
        XCTAssertEqual(XCTWaiter.wait(for: [copied], timeout: 3), .completed)

        sharing.tap()
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
        attachScreenshot(app, name: "Settings – compact groups in dark appearance")
        system.tap()
        XCTAssertTrue(system.isSelected)
        if !app.buttons["forgetComputer"].isHittable { app.swipeDown() }
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
        let app = makeApplication()
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
        let app = makeApplication()
        let conversation = pairFixture(app, code: "ios-test")
        app.buttons["closeSidebar"].tap()
        let home = app.textViews["homeMessageInput"]
        home.tap(); home.typeText("A short keyboard draft")
        assertComposerAboveKeyboard(app)
        home.typeText("\nAnother line\nA third line")
        assertComposerAboveKeyboard(app)
        openSidebar(app); conversation.tap()
        let input = app.textViews.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("A conversation keyboard draft")
        assertComposerAboveKeyboard(app)
        input.typeText("\nAnother line\nA third line")
        assertComposerAboveKeyboard(app)
        forgetFixture(app)
    }

    private func assertComposerAboveKeyboard(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), file: file, line: line)
        let keyboardTop = keyboard.frame.minY
        let send = app.buttons["Send message"]
        let model = app.buttons.matching(NSPredicate(format: "identifier == %@ OR label BEGINSWITH %@", "chooseModel", "Balanced")).firstMatch
        for button in [app.buttons["Add attachment"], model, send] {
            XCTAssertTrue(button.isHittable, file: file, line: line)
            XCTAssertLessThanOrEqual(button.frame.maxY, keyboardTop - 4, "\(button.label) must be fully above the keyboard", file: file, line: line)
        }
        let dismiss = app.buttons["dismissKeyboard"]
        if dismiss.exists {
            XCTAssertFalse(dismiss.frame.intersects(send.frame), "Keyboard dismissal must not cover Send", file: file, line: line)
        }
    }

    func testDataSharingDeclineKeepsDraftAndAllowSendsOnce() async throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-home")
        chooseSidebarSpace("fixture-claude", in: app)
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
            let picker = app.descendants(matching: .any).matching(identifier: "selectModel").firstMatch
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
        let app = makeApplication()
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
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-home")
        chooseSidebarSpace("fixture-claude", in: app)
        XCTAssertTrue(app.buttons["closeSidebar"].waitForNonExistence(timeout: 5))
        let draft = app.textViews["homeMessageInput"]
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        draft.tap(); assertKeyboardVisible(app)
        draft.typeText("Keep this draft")
        app.buttons["chooseModel"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "selectModel").firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["model-fixture-balanced"].exists)
        XCTAssertFalse(app.navigationBars["Select model"].exists)
        attachScreenshot(app, name: "Native model – inline wheel")
        chooseModel("fixture-thinking", in: app)
        let thinking = app.switches["thinkingToggle"]
        XCTAssertTrue(thinking.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "effortSlider").firstMatch.exists)
        thinking.tap(); XCTAssertEqual(thinking.value as? String, "1")
        app.buttons["closeEffortOverlay"].tap()
        XCTAssertTrue(app.buttons["closeEffortOverlay"].waitForNonExistence(timeout: 5))
        app.buttons["chooseModel"].tap()
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
        let closeEffort = app.buttons["closeEffortOverlay"]
        closeEffort.tap()
        XCTAssertTrue(closeEffort.waitForNonExistence(timeout: 5))
        XCTAssertEqual(draft.value as? String, "Keep this draft")
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Ultracode"))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["chooseModel"].waitForExistence(timeout: 10))
        let restoredEffort = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Ultracode"), object: app.buttons["chooseModel"])
        let restored = await XCTWaiter.fulfillment(of: [restoredEffort], timeout: 10)
        XCTAssertEqual(restored, .completed, "Restored model and effort: \(app.buttons["chooseModel"].label)")
        app.buttons["runOptions"].tap()
        _ = permissionWheel("Auto", in: app)
        stepPermission("Ask permissions", below: false, in: app)
        attachScreenshot(app, name: "Native run options – Claude permissions")
        closeRunOptions(in: app)
        forgetFixture(app)
    }

    func testSearchChatsWorkspacesClearAndClose() throws {
        continueAfterFailure = false
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-workspace")
        let sidebarSearch = app.buttons["sidebarSearch"]
        let sidebarSearchFrame = sidebarSearch.frame
        let hint = app.staticTexts["Search chats, messages and workspaces"]
        let closeSearch = app.buttons["closeGlobalSearch"]
        let keyboard = app.keyboards.firstMatch
        let input = app.textFields["globalSearchInput"]
        func assertInputAboveKeyboard() {
            let positioned = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard input.exists, keyboard.exists, closeSearch.exists else { return false }
                let gap = keyboard.frame.minY - input.frame.maxY
                return gap >= -1 && gap < 80 && app.frame.contains(input.frame) && app.frame.contains(closeSearch.frame)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [positioned], timeout: 5), .completed)
        }
        func openSearch() {
            sidebarSearch.tap()
            XCTAssertTrue(input.waitForExistence(timeout: 5))
            XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
            assertInputAboveKeyboard()
            XCTAssertTrue(hint.exists)
            XCTAssertEqual(hint.frame.midX, app.frame.midX, accuracy: 2)
        }
        func dismissSearch() {
            closeSearch.tap()
            XCTAssertTrue(app.buttons["openSettings"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["openSettings"].isHittable)
            XCTAssertTrue(app.buttons["closeSidebar"].exists)
            XCTAssertFalse(input.exists)
            XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
            XCTAssertEqual(sidebarSearch.frame, sidebarSearchFrame)
        }
        openSearch()
        attachScreenshot(app, name: "Global search empty illustration")
        dismissSearch()
        openSearch()
        let hintCenter = hint.frame.midY
        input.typeText("No matching result")
        XCTAssertEqual(input.value as? String, "No matching result", "Changing search results must preserve the editor and its focus.")
        let noResults = app.staticTexts["No results found"]
        XCTAssertTrue(noResults.waitForExistence(timeout: 5))
        XCTAssertEqual(noResults.frame.midY, hintCenter, accuracy: 12)
        app.buttons["clearGlobalSearch"].tap()
        XCTAssertTrue(app.staticTexts["Search chats, messages and workspaces"].exists)
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
        openSearch()
        dismissSearch()
        forgetFixture(app)
    }

    func testDisconnectedScreensRecoverAndKeepLoadedMates() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-mate-info")
        let disconnected = app.staticTexts["Computer disconnected"]
        let fixtureMate = app.buttons["mate-fixture-mate"]
        var offline = URLRequest(url: URL(string: "http://127.0.0.1:18787/test/offline")!)
        offline.httpMethod = "POST"
        offline.httpBody = Data(#"{"durationMs":12000}"#.utf8)

        _ = try await URLSession.shared.data(for: offline)
        app.buttons["openMates"].tap()
        let matesMessage = app.staticTexts["Connect to your computer to use Mates."]
        XCTAssertTrue(matesMessage.waitForExistence(timeout: 5))
        XCTAssertTrue(disconnected.exists)
        XCTAssertLessThan(disconnected.frame.maxY, matesMessage.frame.minY)
        XCTAssertGreaterThan(disconnected.frame.minY, app.frame.height * 0.32)
        attachScreenshot(app, name: "Mates disconnected")
        XCTAssertTrue(fixtureMate.waitForExistence(timeout: 24))
        XCTAssertFalse(disconnected.exists)

        _ = try await URLSession.shared.data(for: offline)
        XCTAssertTrue(app.staticTexts["Connect to your computer to refresh Mates."].waitForExistence(timeout: 5))
        XCTAssertTrue(fixtureMate.exists)
        app.navigationBars.buttons["BackButton"].tap()
        openSidebar(app)
        app.buttons["openAtlas"].tap()
        XCTAssertTrue(app.staticTexts["Connect to your computer to browse Atlas."].waitForExistence(timeout: 5))
        XCTAssertTrue(disconnected.exists)
        attachScreenshot(app, name: "Atlas disconnected")
        XCTAssertTrue(app.buttons["atlasItem-fixture-atlas-page"].waitForExistence(timeout: 24))
        XCTAssertFalse(disconnected.exists)
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testHomeConnectionRecoveryKeepsDraftAndOpensComputer() async throws {
        continueAfterFailure = false
        let app = makeApplication()
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
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-workspace")
        chooseSidebarSpace("fixture-code", in: app)
        openSidebar(app)
        app.buttons["workspace-fixture-workspace"].tap()
        let input = app.textFields["workspaceSearch"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let title = app.staticTexts["pageTitle"]
        XCTAssertTrue(title.exists)
        XCTAssertEqual(title.label, "mains")
        XCTAssertFalse(app.staticTexts["inlinePageTitle"].exists)
        XCTAssertTrue(app.staticTexts["main"].exists)
        XCTAssertTrue(app.buttons["conversation-workspace-first"].exists)
        XCTAssertTrue(app.buttons["conversation-workspace-second"].exists)
        XCTAssertTrue(app.buttons["conversation-workspace-third"].exists)
        XCTAssertFalse(app.staticTexts["Conversations"].exists)
        attachScreenshot(app, name: "Native workspace – conversation list")
        let list = app.scrollViews["targetConversationList"]
        list.swipeUp()
        let compactTitle = app.staticTexts["inlinePageTitle"]
        XCTAssertTrue(compactTitle.waitForExistence(timeout: 5))
        XCTAssertEqual(compactTitle.label, "mains")
        XCTAssertEqual(compactTitle.frame.midX, app.frame.midX, accuracy: 3)
        XCTAssertGreaterThan(compactTitle.frame.width, 36)
        attachScreenshot(app, name: "Native workspace – scrolled title")
        list.swipeDown()
        XCTAssertTrue(compactTitle.waitForNonExistence(timeout: 5))
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

    func testCodexGoalSummaryFollowsAStartedRun() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        let otherConversation = pairFixture(app, code: "ios-test")
        await chooseSidebarMode("work", in: app)
        app.buttons["closeSidebar"].tap()
        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        app.buttons["runOptions"].tap()
        let goal = app.switches["runGoalMode"]
        assertControl(goal, value: "0")
        goal.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()
        assertControl(goal, value: "1")
        closeRunOptions(in: app)

        let objective = "Refactor the hero section"
        input.tap(); input.typeText(objective)
        app.buttons["startConversation"].tap()
        let allow = app.buttons["allowDataSharing"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let bar = app.descendants(matching: .any)["conversationGoalBar"].firstMatch
        let usage = bar.staticTexts["goalSummaryUsage"].firstMatch
        XCTAssertTrue(bar.staticTexts["Pursuing goal"].waitForExistence(timeout: 5))
        XCTAssertTrue(bar.staticTexts[objective].exists)
        attachScreenshot(app, name: "Active Codex goal")
        XCTAssertTrue(usage.exists)
        XCTAssertEqual(usage.label.components(separatedBy: " · ").first?.filter(\.isNumber), "26438")
        XCTAssertLessThanOrEqual(bar.frame.maxY, app.textViews["messageInput"].frame.minY)
        XCTAssertTrue(bar.staticTexts["Goal complete"].waitForExistence(timeout: 10))
        XCTAssertEqual(usage.label.components(separatedBy: " · ").first?.filter(\.isNumber), "28000")
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 5))

        openSidebar(app)
        await chooseSidebarMode("chat", in: app)
        otherConversation.tap()
        XCTAssertTrue(app.staticTexts["Hello from the computer."].waitForExistence(timeout: 5))
        XCTAssertFalse(bar.exists)
        app.navigationBars.buttons["BackButton"].tap()
        forgetFixture(app)
    }

    func testCodexGoalControlsEditPauseResumeAndClear() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        _ = pairFixture(app, code: "ios-test-goal-controls")
        await chooseSidebarMode("work", in: app)
        app.buttons["closeSidebar"].tap()
        let input = app.textViews["homeMessageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        app.buttons["runOptions"].tap()
        let goalMode = app.switches["runGoalMode"]
        assertControl(goalMode, value: "0")
        goalMode.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()
        assertControl(goalMode, value: "1")
        closeRunOptions(in: app)

        input.tap(); input.typeText("Refactor the hero section")
        app.buttons["startConversation"].tap()
        let allow = app.buttons["allowDataSharing"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let bar = app.descendants(matching: .any)["conversationGoalBar"].firstMatch
        let status = bar.staticTexts["Pursuing goal"]
        XCTAssertTrue(status.waitForExistence(timeout: 8))
        let objective = bar.staticTexts["Refactor the hero section"]
        XCTAssertEqual(status.frame.midY, app.buttons["editGoal"].frame.midY, accuracy: 2)
        XCTAssertEqual(status.frame.minY - bar.frame.minY, bar.frame.maxY - objective.frame.maxY, accuracy: 3)
        attachScreenshot(app, name: "Codex goal controls")

        app.buttons["editGoal"].tap()
        let editor = app.textViews["goalObjectiveInput"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, "Refactor the hero section")
        editor.tap(); editor.typeText(" Make it responsive.")
        let edited = try XCTUnwrap(editor.value as? String).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertTrue(edited.contains("Make it responsive."))
        app.buttons["saveGoalObjective"].tap()
        XCTAssertTrue(editor.waitForNonExistence(timeout: 5))
        XCTAssertTrue(bar.staticTexts[edited].waitForExistence(timeout: 5))

        app.buttons["pauseGoal"].tap()
        XCTAssertTrue(bar.staticTexts["Goal paused"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.buttons["stopReply"].exists)
        let resume = app.buttons["resumeGoal"]
        let resumedControl = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: resume)
        let ready = await XCTWaiter.fulfillment(of: [resumedControl], timeout: 8)
        XCTAssertEqual(ready, .completed)
        resume.tap()
        XCTAssertTrue(bar.staticTexts["Pursuing goal"].waitForExistence(timeout: 5))

        let clear = app.buttons["clearGoal"]
        let confirmation = app.alerts["Clear this goal?"]
        clear.tap()
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.buttons["Cancel"].tap()
        XCTAssertTrue(bar.exists)
        clear.tap()
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.buttons["Clear goal"].tap()
        XCTAssertTrue(bar.waitForNonExistence(timeout: 8))
        XCTAssertTrue(app.buttons["stopReply"].exists)

        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let goalCalls = calls.filter { $0["channel"] as? String == "providers:changeMobileGoal" }
        let actions = try goalCalls.map { call in
            let args = try XCTUnwrap(call["args"] as? [Any])
            let change = try XCTUnwrap(args[1] as? [String: String])
            return try XCTUnwrap(change["action"])
        }
        XCTAssertEqual(actions, ["edit", "pause", "pause", "resume", "clear"])
        XCTAssertEqual(goalCalls[1]["commandId"] as? String, goalCalls[2]["commandId"] as? String)
        XCTAssertFalse(calls.contains { $0["channel"] as? String == "runs:abort" })
        forgetFixture(app)
    }

    func testRunOptionsControlsAndPersistence() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        pairFixture(app, code: "ios-test-design", search: true).tap()
        let options = app.buttons["runOptions"]
        XCTAssertTrue(options.waitForExistence(timeout: 10))
        attachScreenshot(app, name: "Composer options – Fast and Goal off")
        options.tap()
        let permissions = permissionWheel("Auto", in: app)
        // The machine's policy forbids Full Access, the next option below Auto.
        permissions.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        XCTAssertTrue((permissions.value as? String)?.hasPrefix("Auto") == true)
        let plan = app.switches["runPlanMode"]
        let goal = app.switches["runGoalMode"]
        let trailing = CGVector(dx: 0.94, dy: 0.5)
        plan.coordinate(withNormalizedOffset: trailing).tap(); assertControl(plan, value: "1")
        goal.coordinate(withNormalizedOffset: trailing).tap(); assertControl(goal, value: "1")
        XCTAssertEqual(plan.value as? String, "0")
        goal.coordinate(withNormalizedOffset: trailing).tap(); assertControl(goal, value: "0")
        let fast = app.buttons["runFastMode"]
        assertControl(fast, value: "Off")
        attachScreenshot(app, name: "Run Options – Fast off")
        fast.tap(); assertControl(fast, value: "On")
        let tiers = app.buttons["runServiceTier"]
        assertControl(tiers, value: "Fast")
        attachScreenshot(app, name: "Run Options – Fast on")
        closeRunOptions(in: app)
        attachScreenshot(app, name: "Composer options – Fast only")
        options.tap()
        assertControl(fast, value: "On")
        tiers.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let ultrafast = app.buttons["Ultrafast"]
        XCTAssertTrue(ultrafast.waitForExistence(timeout: 5)); ultrafast.tap()
        assertControl(tiers, value: "Ultrafast")
        goal.coordinate(withNormalizedOffset: trailing).tap(); assertControl(goal, value: "1")
        closeRunOptions(in: app)
        attachScreenshot(app, name: "Composer options – Fast and Goal on")
        options.tap()
        fast.tap(); assertControl(fast, value: "Off")
        closeRunOptions(in: app)
        attachScreenshot(app, name: "Composer options – Goal only")

        options.tap()
        goal.coordinate(withNormalizedOffset: trailing).tap(); assertControl(goal, value: "0")
        let wheel = permissionWheel("Auto", in: app)
        let start = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.25)
        _ = permissionWheel("Read Only", in: app)
        closeRunOptions(in: app)

        let input = app.textViews["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("Use my selected permissions")
        app.buttons["sendMessage"].tap()
        let consent = app.buttons["allowDataSharing"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        XCTAssertTrue(app.staticTexts["Native reply delivered."].waitForExistence(timeout: 15))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18787/observations")!)
        let calls = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let call = try XCTUnwrap(calls.last { $0["channel"] as? String == "runs:continue" })
        let payload = try XCTUnwrap((call["args"] as? [[String: Any]])?.first)
        let settings = try XCTUnwrap(payload["conversationSettings"] as? [String: Any])
        let config = try XCTUnwrap(settings["config"] as? [String: Any])
        XCTAssertEqual(config["sandboxMode"] as? String, "read-only")
        XCTAssertEqual(config["serviceTier"] as? String, "default")
        forgetFixture(app)
    }

    func testConversationReferenceLayoutSettingsAndOutputs() async throws {
        continueAfterFailure = false
        let app = makeApplication()
        app.launchArguments += ["-appearancePreference", "dark"]
        let conversation = pairFixture(app, code: "ios-test-design", search: true)
        conversation.tap()
        let readers = ["conversationTranscript", "conversationWorkspace-conversation"]
        let transcript = app.scrollViews.matching(NSPredicate(format: "identifier IN %@", readers)).firstMatch
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
        let closeEffort = app.buttons["closeEffortOverlay"]
        closeEffort.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(closeEffort.waitForNonExistence(timeout: 5))
        XCTAssertTrue(details.exists)
        XCTAssertEqual(details.frame.minY, readingPosition, accuracy: 8)
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Deep Thinker"))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Extra High"))
        app.buttons["runOptions"].tap()
        let wheel = permissionWheel("Auto", in: app)
        let start = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.25)
        _ = permissionWheel("Read Only", in: app)
        XCTAssertFalse(app.buttons["runFastMode"].exists)
        closeRunOptions(in: app)

        app.buttons["conversationOutputs"].tap()
        let output = app.buttons["output-503"]
        XCTAssertTrue(output.waitForExistence(timeout: 10)); output.tap()
        XCTAssertTrue(app.buttons["fileOptions"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Article summary"].waitForExistence(timeout: 10))
        attachScreenshot(app, name: "Native conversation – output preview")
        let closePreview = app.buttons["Close preview"]
        closePreview.tap()
        XCTAssertTrue(closePreview.waitForNonExistence(timeout: 5))
        app.buttons["closeComposerSheet"].tap()
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
        let app = makeApplication()
        _ = pairFixture(app, code: "ios-test-home")
        XCTAssertTrue(app.staticTexts["Projects"].exists)
        attachScreenshot(app, name: "Native sidebar – projects")
        chooseSidebarSpace("fixture-claude", in: app)
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
        XCTAssertTrue(app.buttons["closeSidebar"].waitForNonExistence(timeout: 5))
        app.buttons["chooseTarget"].tap()
        let projects = targetWheel("No project", in: app)
        projects.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        _ = targetWheel("Kitchen Notes", in: app)
        attachScreenshot(app, name: "Native project – compact selection")
        confirmTarget(in: app)
        XCTAssertTrue(app.buttons["chooseTarget"].label.contains("Kitchen Notes"))
        attachScreenshot(app, name: "Native project – icon color target")

        openSidebar(app)
        await chooseSidebarMode("chat", in: app)
        XCTAssertTrue(app.buttons["conversation-fixture-chat"].exists)
        XCTAssertFalse(app.buttons["conversation-fixture-work"].exists)
        attachScreenshot(app, name: "Native sidebar – Chat tabs")
        app.buttons["closeSidebar"].tap()
        app.buttons["runOptions"].tap()
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "selectPermission").firstMatch.exists)
        let fast = app.buttons["runFastMode"]
        assertControl(fast, value: "Off")
        fast.tap(); assertControl(fast, value: "On")
        fast.tap(); assertControl(fast, value: "Off")
        closeRunOptions(in: app)

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
        _ = targetWheel("mains", in: app)
        attachScreenshot(app, name: "Native workspace – compact selection")
        confirmTarget(in: app)

        app.buttons["chooseModel"].tap()
        chooseModel("fixture-deep", in: app)
        attachScreenshot(app, name: "Native model selection")
        selectEffort(at: 0.5, in: app)
        attachScreenshot(app, name: "Native effort selection")
        let closeEffort = app.buttons["closeEffortOverlay"]
        closeEffort.tap()
        XCTAssertTrue(closeEffort.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("Deep Thinker"))
        XCTAssertTrue(app.buttons["chooseModel"].label.contains("High"))
        app.buttons["runOptions"].tap()
        _ = permissionWheel("Auto", in: app)
        stepPermission("Auto accept edits", below: true, in: app)
        stepPermission("Plan mode", below: true, in: app)
        attachScreenshot(app, name: "Native run options")
        closeRunOptions(in: app)

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
        chooseSidebarSpace("fixture-copilot", in: app)
        openSidebar(app)
        XCTAssertTrue(app.buttons["sidebarMode-developer"].isSelected)
        XCTAssertFalse(app.buttons["sidebarMode-work"].exists)
        XCTAssertFalse(app.buttons["sidebarMode-chat"].exists)
        chooseSidebarSpace("fixture-claude", in: app)
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
        let app = makeApplication()
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
        let app = makeApplication()
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

    private func chooseSidebarSpace(_ id: String, in app: XCUIApplication) {
        let button = app.buttons["space-" + id]
        if button.exists && button.isSelected {
            app.buttons["closeSidebar"].tap()
            return
        }
        if !button.exists {
            let selected = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND selected == true", "space-")).firstMatch
            XCTAssertTrue(selected.waitForExistence(timeout: 5)); selected.tap()
        }
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        let strip = app.scrollViews["sidebarProviderStrip"]
        for _ in 0..<8 {
            if button.isHittable { break }
            strip.swipeLeft()
        }
        XCTAssertTrue(button.isHittable); button.tap()
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

    private func closeRunOptions(in app: XCUIApplication) {
        let close = app.buttons["closeRunOptions"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
    }

    private func assertControl(_ control: XCUIElement, value: String) {
        let ready = NSPredicate(format: "enabled == true AND value == %@", value)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: control)], timeout: 8), .completed)
    }

    private func targetWheel(_ title: String, in app: XCUIApplication) -> XCUIElement {
        let wheel = app.descendants(matching: .any).matching(identifier: "selectTarget").firstMatch
        let ready = NSPredicate(format: "enabled == true AND value BEGINSWITH %@", title)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: wheel)], timeout: 8), .completed)
        return wheel
    }

    private func confirmTarget(in app: XCUIApplication) {
        let confirm = app.buttons["confirmTarget"]
        XCTAssertTrue(confirm.isHittable)
        confirm.tap()
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 5))
    }

    private func permissionWheel(_ title: String, in app: XCUIApplication) -> XCUIElement {
        let wheel = app.descendants(matching: .any).matching(identifier: "selectPermission").firstMatch
        let ready = NSPredicate(format: "enabled == true AND value BEGINSWITH %@", title)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: wheel)], timeout: 8), .completed)
        return wheel
    }

    private func stepPermission(_ title: String, below: Bool, in app: XCUIApplication) {
        let wheel = app.descendants(matching: .any).matching(identifier: "selectPermission").firstMatch
        wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: below ? 0.8 : 0.2)).tap()
        _ = permissionWheel(title, in: app)
    }

    private func chooseModel(_ id: String, in app: XCUIApplication) {
        let ids = ["fixture-balanced", "fixture-thinking", "fixture-single", "fixture-deep"]
        let names = ["Balanced", "Thinking toggle", "Single effort", "Deep Thinker"]
        guard let target = ids.firstIndex(of: id) else { XCTFail("Unknown fixture model: \(id)"); return }
        let wheel = app.descendants(matching: .any).matching(identifier: "selectModel").firstMatch
        XCTAssertTrue(wheel.waitForExistence(timeout: 5))
        let initialY = wheel.frame.midY
        for _ in 0..<8 {
            let value = wheel.value as? String ?? ""
            guard let current = names.firstIndex(where: { value.hasPrefix($0) }) else { XCTFail("Unknown wheel value: \(value)"); return }
            if current == target { break }
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: wheel)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
            let next = current + (current < target ? 1 : -1)
            let start = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let end = wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: current < target ? 0.2 : 0.8))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.25)
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND value BEGINSWITH %@", names[next]), object: wheel)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed)
        }
        XCTAssertTrue((wheel.value as? String ?? "").hasPrefix(names[target]))
        XCTAssertEqual(wheel.frame.midY, initialY, accuracy: 1, "Changing model capabilities must not move the wheel")
        XCTAssertFalse(app.navigationBars["Select model"].exists)
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
