import Foundation
import Testing
@testable import TermCore

private func component(_ name: String, _ weight: Double = 100, points: Double? = nil) -> GradingComponent {
  GradingComponent(name: name, weight: weight, kind: "other", points: points)
}

private func route(_ text: String, _ result: GradingResult) async throws -> SectionOutcome<GradingResult> {
  let schedule: Runner<ScheduleResult> = { _ in (ScheduleResult(items: []), .onDevice) }
  let opts = RouterOptions(deviceGrading: { _ in (result, .onDevice) }, cloudGrading: { _ in (nil, .inCloud) },
                           deviceSchedule: schedule, cloudSchedule: schedule)
  return try await extractTermPlan(text, year: 2026, opts).grading
}

@Suite struct ChecksV3Tests {
  @Test(arguments: [
    ["10 Problem Sets", "Problem Sets"], ["2 Midterm Exams", "Midterm Exams"], ["1 Final Exam", "Final Exam"],
    ["At least 2 Homework Assignments", "Homework Assignments"],
    ["4 reading response essays (1 page)", "Reading response essays"], ["exam2", "Second exam"],
    ["Midterm II", "2nd midterm"], ["Blog post 3", "Third blog post"],
    ["Exams 1", "Exam 1"], ["Exam 1", "Exams 1"], ["QuizzesII", "Quiz 2"], ["Blog Posts 3", "Blog Post 3"],
  ]) func ordinalBinding(_ pair: [String]) {
    #expect(ordinals(pair[0]) == ordinals(pair[1]))
    #expect(checkGrading(GradingResult(components: [component(pair[0])]), source: pair[1] + " 100%").ok)
  }

  @Test func tenOrdinalForms() {
    let words = "first second third fourth fifth sixth seventh eighth ninth tenth".split(separator: " ")
    let roman = "i ii iii iv v vi vii viii ix x".split(separator: " ")
    for i in words.indices {
      let n = i + 1
      let suffix = i < 3 ? ["st", "nd", "rd"][i] : "th"
      for label in [String(words[i]), String(n) + suffix, "Exam\(n)", "Midterm " + roman[i]] {
        #expect(ordinals(label) == [n])
      }
    }
    #expect(ordinals("Essay (second revision)") == [2])
    for noun in ["exam", "midterm", "test", "quiz", "paper", "essay", "project", "assignment",
                 "homework", "problem set", "lab", "blog post", "post", "presentation", "report"] {
      #expect(ordinals(noun + "4") == [4])
    }
    #expect(ordinals("10 quizzes (paper 1, exam II) at least 2, I agree").isEmpty)
    #expect(!ordinalsMatch("exam2", "exam3"))
    #expect(!ordinalsMatch("Exams 1", "Exam 2"))
  }

  @Test func aggregateHints() {
    for (name, weight, text) in [("Exams", 70.0, "Exams (70%): midterm 30%, final 40%"),
                                 ("Tests", 45.0, "Three tests, 15% each"),
                                 ("Midterms", 43.0, "Midterm 1 18%, Midterm 2 25%")] {
      let check = checkGrading(GradingResult(components: [component(name, weight)]), source: text)
      #expect(check.issues.contains(Issue(code: "group-has-parts", severity: .fail, message: "Split '\(name)' into its parts")))
    }
    #expect(gradingPrompt("Quiz 100%").contains("List each separately weighted item"))
    let swapped = GradingResult(components: [component("Midterm 1", 25)])
    #expect(checkGrading(swapped, source: "Midterm 1 18%, Midterm 2 25%").issues.contains { $0.code == "weight-not-bound" })
  }

  @Test func countedGroupsRepairLocally() async throws {
    for (count, noun, n, each) in [("three tests", "Test", 3, 15), ("3 tests", "Test", 3, 15), ("two midterms", "Midterm", 2, 25)] {
      let row = "\(count), \(each)% each"
      let rest = 100 - n * each
      let text = row + "\nPortfolio \(rest)%"
      let out = try await route(text, GradingResult(components: [component(noun + "s", Double(n * each)), component("Portfolio", Double(rest))]))
      #expect(!out.escalated && out.repairedItems == 1 && out.finalReport.ok)
      let parts = try #require(out.value?.components.prefix(n))
      #expect(parts.map(\.name) == (1...n).map { "\(noun) \($0)" })
      #expect(parts.allSatisfy { $0.weight == Double(each) && evidenceFor($0, source: text) == row })
    }
    let out = try await route("Tests, 15% each\nPaper 55%", GradingResult(components: [component("Tests", 45), component("Paper", 55)]))
    #expect(out.escalated)
  }

  @Test func partsInComponentName() async throws {
    let source = "Midterms 43%\nPortfolio 57%"
    let grouped = GradingResult(components: [component("Midterms (18% and 25% respectively)", 43), component("Portfolio", 57)])
    #expect(checkGrading(grouped, source: source).issues.map(\.code) == ["group-has-parts"])
    let mismatch = GradingResult(components: [component("Midterms (18% and 24% respectively)", 43), component("Portfolio", 57)])
    #expect(checkGrading(mismatch, source: source).ok)
    let out = try await route("Midterms 43%\nMidterm 1 18%\nPortfolio 57%\nMidterm 2 25%", grouped)
    #expect(!out.escalated && out.repairedItems == 1 && out.finalReport.ok)
    #expect(out.value?.components == [component("Midterm 1", 18), component("Midterm 2", 25), component("Portfolio", 57)])
  }

  @Test(arguments: ["Midterms (18% and 25% respectively)", "Midterms 43% (18% and 25% respectively)"])
  func repairsUnnamedParts(_ row: String) async throws {
    let source = row + "\nPortfolio 57%"
    let grouped = GradingResult(components: [component("Midterms (18% and 25% respectively)", 43), component("Portfolio", 57)])
    let out = try await route(source, grouped)
    #expect(out.firstReport.issues.map(\.code) == ["group-has-parts"])
    #expect(!out.escalated && out.repairedItems == 1 && out.finalReport.ok)
    let parts = try #require(out.value?.components)
    #expect(parts == [component("Midterm 1", 18), component("Midterm 2", 25), component("Portfolio", 57)])
    #expect(parts.prefix(2).allSatisfy { evidenceFor($0, source: source) == row })
    let swapped = GradingResult(components: [component("Midterm 2", 18), component("Midterm 1", 25), component("Portfolio", 57)])
    #expect(checkGrading(swapped, source: source).issues.map(\.code) == ["weight-not-bound", "weight-not-bound"])
  }

  @Test func repairsNamedPercentageParts() async throws {
    let result = GradingResult(components: [component("Exams", 70), component("Portfolio", 30)])
    let out = try await route("Exams (70%): midterm 30%, final 40%\nPortfolio 30%", result)
    #expect(!out.escalated && out.repairedItems == 1 && out.finalReport.ok)
    #expect(out.value?.components == [component("Midterm", 30), component("Final", 40), component("Portfolio", 30)])
  }

  @Test func repairsNamedPointsParts() async throws {
    let row = "Exams—400 points (One Midterm worth 200 points and a final exam worth 200 points)"
    let source = row + "\nPortfolio 100 points"
    let result = GradingResult(components: [component("Exams", points: 400), component("Portfolio", points: 100)])
    let out = try await route(source, result)
    #expect(out.firstReport.issues.map(\.code) == ["group-has-parts"])
    #expect(!out.escalated && out.repairedItems == 1 && out.finalReport.ok)
    #expect(out.value?.totalPoints == 500)
    let parts = try #require(out.value?.components)
    #expect(parts == [component("Midterm", 40, points: 200), component("Final exam", 40, points: 200), component("Portfolio", 20, points: 100)])
    #expect(parts.prefix(2).allSatisfy { evidenceFor($0, source: source) == row })
  }

  @Test func pointsExtractionAndFallbackTotal() async throws {
    for total in [1000.0, nil] {
      let text = "Intro\nHomework\n300 points\nProject 700 pts" + (total == nil ? "" : "\nTotal 1,000 points")
      let out = try await route(text, GradingResult(components: [component("Homework", points: 300), component("Project", points: 700)], totalPoints: total))
      #expect(!out.escalated && out.finalReport.ok)
      #expect(out.value?.totalPoints == 1000)
      #expect(out.value?.components.map(\.weight) == [30, 70])
      let c = try #require(out.value?.components.first)
      #expect(evidenceFor(c, source: text)?.contains("300 points") == true)
      #expect(gradingPrompt(sliceSection(text, .grading)).contains("totalPoints"))
    }
  }

  @Test func pointsOnlyJSONDecodes() throws {
    let json = #"{"components":[{"name":"Studio","kind":"other","points":90}],"totalPoints":90}"#
    var result: GradingResult? = try JSONDecoder().decode(GradingResult.self, from: Data(json.utf8))
    #expect(checkGrading(&result, source: "Studio 90 pts").ok)
    #expect(result?.components.first?.weight == 100)
  }

  @Test func groupedRowsAndIndependentCategories() {
    let text = "Midterm 1 18%\nMidterm 2 25%\nHomework 57%"
    let grouped = GradingResult(components: [component("Midterms", 43), component("Homework", 57)])
    #expect(checkGrading(grouped, source: text).issues.map(\.code) == ["group-has-parts"])
    let ordinary = GradingResult(components: [component("Project", 50), component("Test", 30), component("Essay", 20)])
    #expect(checkGrading(ordinary, source: "Project 50%, Test 30%, Essay 20%").ok)
    #expect(checkGrading(ordinary, source: "Project 50% (see rubric)\nTest 30%\nEssay 20%").ok)
  }

  @Test func independentEachRates() async throws {
    let source = "Two tests, 25% each; two papers, 10% each; Portfolio 30%"
    let out = try await route(source, GradingResult(components: [component("Tests", 50), component("Papers", 20), component("Portfolio", 30)]))
    #expect(!out.escalated && out.repairedItems == 2 && out.finalReport.ok)
    #expect(out.value?.components.map(\.weight) == [25, 25, 10, 10, 30])
  }

  @Test func toleranceAfterConversion() {
    for (points, expected) in [(9950.0, true), (9949.0, false)] {
      let result = GradingResult(components: [component("Studio", points: points)], totalPoints: 10000)
      #expect(checkGrading(result, source: "Studio \(points) points\nTotal 10000 pts").ok == expected)
    }
  }

  @Test func pointsValidation() {
    #expect(!sliceSection("Old 50 pts\nUnrelated\nGrading\nEssay 100%", .grading).contains("pts"))
    let text = "Quiz 1 point\nEssay 2 points\nTotal 3 pts"
    var result: GradingResult? = GradingResult(components: [component("Quiz", points: 1), component("Essay", points: 2)])
    #expect(checkGrading(&result, source: text).ok)
    #expect(result?.components.map(\.weight) == [33.33, 66.67])
    result?.totalPoints = 4
    #expect(Set(checkGrading(result, source: text).issues.map(\.code)) == ["total-points", "sum"])
    result?.totalPoints = 6
    #expect(checkGrading(result, source: text.replacingOccurrences(of: "Total 3", with: "Total 6")).issues.map(\.code) == ["sum"])
    let swapped = GradingResult(components: [component("Essay", points: 1)])
    #expect(checkGrading(swapped, source: text).issues.contains { $0.code == "weight-not-bound" })
  }

  @Test(arguments: ["Type   %   Description", "Component   Weight   Notes"]) func unitlessTable(_ header: String) {
    let source = ["Intro", header, "Exams   60   Quiz 1 (25), Quiz 2 (35)", "Portfolio   40   Design work",
                  "End of table.", "Room   99   Wednesday"].joined(separator: "\n")
    let slice = sliceSection(source, .grading)
    #expect(slice.contains(header) && !slice.contains("Room"))
    let result = GradingResult(components: [component("Quiz 1", 25), component("Quiz 2", 35), component("Portfolio", 40)])
    #expect(checkGrading(result, source: slice).ok)
    #expect(evidenceFor(result.components[0], source: slice)?.contains("Quiz 1 (25)") == true)
    #expect(checkGrading(GradingResult(components: [component("Exams", 60)]), source: slice).issues.contains { $0.code == "group-has-parts" })
  }
}
