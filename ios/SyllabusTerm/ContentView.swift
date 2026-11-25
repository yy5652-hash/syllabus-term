import FoundationModels
import SwiftUI
import TermCore
import UniformTypeIdentifiers

// The points prompt has its own structured answer on both model paths.
@Generable private struct PointComponent {
  var name: String
  var points: Double
  @Guide(.anyOf(["exam", "quiz", "assignment", "project", "participation", "other"])) var kind: String
  var bonus: Bool?
}

@Generable private struct PointGrading {
  var components: [PointComponent]
  var totalPoints: Double?

  var result: GradingResult {
    GradingResult(components: components.map { GradingComponent(name: $0.name, kind: $0.kind, bonus: $0.bonus, points: $0.points) },
                  totalPoints: totalPoints)
  }
}

@MainActor @Observable final class Checker {
  enum Phase { case idle, running, done }
  var phase = Phase.idle
  var text = "" {
    didSet {
      if text != oldValue { term = inferTerm(text) }
    }
  }
  var title = ""
  var term: Term? = nil
  var plan: TermPlan?
  var error: String?

  var termSummary: String {
    guard let term else { return "Term: set start and end dates" }
    if let label = term.label { return "Term: \(label) · from the syllabus" }
    return "Term: \(term.start) to \(term.end)"
  }

  var termForEditing: Term {
    if let term { return term }
    let year = inferYear(text) ?? Calendar.current.component(.year, from: .now)
    return Term(start: "\(year)-01-01", end: "\(year)-12-31")
  }

  func run() async {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { error = "Add a syllabus first."; return }
    error = nil; phase = .running; title = guessTitle(text)
    let settings = await CheckSettings.load()
    let year = Calendar.current.component(.year, from: .now)
    do {
      var options = Models.options(settings: settings, term: term)
      if gradingUsesPoints(text) {
        options.deviceGrading = Models.device(PointGrading.self) { $0.result }
        options.cloudGrading = Models.cloud(PointGrading.self, timeout: settings.cloudTimeout) { $0.result }
      }
      plan = try await extractTermPlan(text, year: year, options)
      phase = .done
    } catch {
      self.error = "The syllabus could not be read. Check your connection and try again. Your text is still here."
      phase = .idle
    }
  }
}

struct ContentView: View {
  @State private var checker = Checker()
  @State private var importing = false
  @State private var pasting = false
  @State private var editingTerm = false

  var body: some View {
    NavigationStack {
      ZStack { Palette.paper.ignoresSafeArea()
        switch checker.phase {
        case .idle: home
        case .running: running
        case .done:
          if let plan = checker.plan {
            ResultView(title: checker.title, termSummary: checker.term == nil ? nil : checker.termSummary, plan: plan) {
              checker.phase = .idle
            }
          }
        }
      }
      .toolbar { ToolbarItem(placement: .principal) { Text("Syllabus → Term").font(.serif(18, .semibold)).foregroundStyle(Palette.ink) } }
      .navigationBarTitleDisplayMode(.inline)
    }
    .tint(Palette.pen)
    .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .plainText]) { result in
      do { checker.text = try SyllabusFile.text(at: result.get()) }
      catch { checker.error = "This file could not be opened. Paste the text instead." }
    }
    .sheet(isPresented: $pasting) { PasteSheet(text: $checker.text) }
    .sheet(isPresented: $editingTerm) {
      TermDateEditor(term: checker.termForEditing) { updated in
        if checker.term?.start != updated.start || checker.term?.end != updated.end { checker.term = updated }
      }
    }
    #if DEBUG
    // Test hook for simulator runs without taps: `-autorunSample` checks the sample on launch.
    .task {
      print("SYLLABUSTERM device model availability: \(SystemLanguageModel.default.availability)")
      if ProcessInfo.processInfo.arguments.contains("-autorunSample") {
        checker.text = Sample.text; await checker.run()
      }
    }
    #endif
  }

  private var home: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Your syllabus, checked on your device.").font(.serif(38)).foregroundStyle(Palette.ink)
          .fixedSize(horizontal: false, vertical: true)
        Text("Apple Intelligence on this iPhone reads the grading weights and deadlines, then every number is checked against the page. Only a section that fails a check goes to Gemini in the cloud.")
          .foregroundStyle(Palette.muted)
        ModelStatusLine()
        VStack(spacing: 12) {
          Button { importing = true } label: { Label("Choose a syllabus PDF", systemImage: "doc.text") }.buttonStyle(PrimaryButton())
          HStack(spacing: 24) {
            Button("Paste text") { pasting = true }
            Button("Try the sample") { checker.text = Sample.text; checker.term = inferTerm(Sample.text) }
          }.font(.body.weight(.bold))
        }
        if !checker.text.isEmpty {
          VStack(alignment: .leading, spacing: 10) {
            Label { VStack(alignment: .leading) {
                Text(guessTitle(checker.text)).font(.serif(18, .semibold)).foregroundStyle(Palette.ink)
                Text("\(checker.text.count.formatted()) characters, still only on this iPhone").font(.subheadline).foregroundStyle(Palette.muted)
              } } icon: { Image(systemName: "book").foregroundStyle(Palette.pen) }
            HStack {
              Text(checker.termSummary).foregroundStyle(Palette.muted)
              Spacer()
              Button(checker.term == nil ? "Set dates" : "Change dates") { editingTerm = true }
            }.font(.subheadline)
            Button("Check my syllabus") { Task { await checker.run() } }.buttonStyle(PrimaryButton())
          }
          .padding(.top, 8).overlay(alignment: .top) { Rectangle().fill(Palette.line).frame(height: 1).offset(y: -4) }
        }
        if let e = checker.error { Text(e).foregroundStyle(Palette.rust).font(.subheadline) }
        Text("On 43 real syllabi (web app): 82% of grading tables matched exactly, every name with its weight, with 5.9% of the text sent to the cloud. Cloud only: 78% and 23%.")
          .font(.footnote).foregroundStyle(Palette.muted).padding(.top, 8)
      }
      .padding(20)
    }
  }

  private var running: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Checking your syllabus").font(.serif(30)).foregroundStyle(Palette.ink)
      Text("Each section is read, then checked against the page. A section that fails goes to the cloud once.")
        .foregroundStyle(Palette.muted)
      ProgressView().controlSize(.large).frame(maxWidth: .infinity).padding(.top, 24)
      Spacer()
    }.padding(20)
  }
}

struct ModelStatusLine: View {
  @State private var ready = Models.deviceReady
  var body: some View {
    Label(ready ? "Apple Intelligence: ready on this iPhone" : "Apple Intelligence not ready: sections are read in the cloud",
          systemImage: ready ? "iphone" : "cloud")
      .font(.subheadline).foregroundStyle(ready ? Palette.pen : Palette.muted)
      .task { // the system model can finish loading after launch
        while !ready && !Task.isCancelled { try? await Task.sleep(for: .seconds(2)); ready = Models.deviceReady }
      }
  }
}

struct PasteSheet: View {
  @Binding var text: String
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      TextEditor(text: $text).scrollContentBackground(.hidden).padding(12).background(Palette.card)
        .navigationTitle("Syllabus text").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
  }
}

struct TermDateEditor: View {
  @Environment(\.dismiss) private var dismiss
  @State private var start: Date
  @State private var end: Date
  let save: (Term) -> Void

  init(term: Term, save: @escaping (Term) -> Void) {
    _start = State(initialValue: TermDates.date(term.start) ?? .now)
    _end = State(initialValue: TermDates.date(term.end) ?? .now)
    self.save = save
  }

  var body: some View {
    NavigationStack {
      Form {
        DatePicker("Start date", selection: $start, displayedComponents: .date)
        DatePicker("End date", selection: $end, displayedComponents: .date)
        if end < start {
          Text("Choose an end date on or after the start date.").foregroundStyle(Palette.rust)
        }
      }
      .navigationTitle("Term dates")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            save(Term(start: TermDates.iso(start), end: TermDates.iso(end)))
            dismiss()
          }.disabled(end < start)
        }
      }
    }
    .environment(\.calendar, TermDates.calendar)
    .environment(\.timeZone, .gmt)
  }
}

struct ResultView: View {
  let title: String
  let termSummary: String?
  let plan: TermPlan
  let back: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Button { back() } label: { Label("Check another syllabus", systemImage: "chevron.left") }.font(.subheadline.weight(.bold))
        Text(title).font(.serif(28)).foregroundStyle(Palette.ink)
        if let termSummary { Text(termSummary).font(.subheadline).foregroundStyle(Palette.muted) }
        SectionCard(heading: "Grading", outcome: Provenance(plan.grading)) {
          let comps = plan.grading.value?.components ?? []
          let ordinary = comps.filter { $0.bonus != true }
          let bonus = comps.filter { $0.bonus == true }
          componentRows(ordinary)
          let sum = ordinary.reduce(0) { $0 + $1.weight }
          HStack {
            Spacer()
            Text("Total \(sum.formatted())%").font(.body.weight(.bold))
              .foregroundStyle(abs(sum - 100) <= SUM_TOLERANCE ? Palette.pen : Palette.rust)
          }
          if !bonus.isEmpty {
            Text("Extra credit").font(.subheadline.weight(.bold)).foregroundStyle(Palette.muted).padding(.top, 8)
            componentRows(bonus)
          }
        }
        SectionCard(heading: "Dates", outcome: Provenance(plan.schedule)) {
          let items = plan.schedule.value?.items ?? []
          if items.isEmpty { Text("No dated exams or deadlines found.").foregroundStyle(Palette.muted) }
          ForEach(items) { it in
            HStack(alignment: .firstTextBaseline) {
              Text(display(it.date)).font(.subheadline.weight(.bold)).foregroundStyle(Palette.pen).frame(width: 64, alignment: .leading)
              Text(it.label)
            }.padding(.vertical, 6)
            Divider().overlay(Palette.line)
          }
          if !items.isEmpty, let url = Calendar_.ics(title: title, items: items) {
            ShareLink(item: url) { Label("Export dates (.ics)", systemImage: "square.and.arrow.up") }
              .buttonStyle(PrimaryButton()).padding(.top, 8)
          }
        }
      }.padding(20)
    }
  }

  private func componentRows(_ components: [GradingComponent]) -> some View {
    ForEach(Array(components.enumerated()), id: \.offset) { _, component in
      HStack {
        VStack(alignment: .leading) {
          Text(component.name)
          if let points = component.points, let total = plan.grading.value?.totalPoints {
            Text("Converted from points (\(points.formatted()) of \(total.formatted()))").font(.footnote)
          }
        }
        Spacer()
        Text("\(component.weight.formatted())%").font(.body.weight(.bold)).monospacedDigit()
      }
      .padding(.vertical, 6)
      Divider().overlay(Palette.line)
    }
  }

  private func display(_ iso: String) -> String {
    guard let date = TermDates.date(iso) else { return iso }
    var style = Date.FormatStyle().month(.abbreviated).day()
    style.timeZone = .gmt
    return date.formatted(style)
  }
}

/// Where a section's answer came from and whether it passed its checks.
struct Provenance {
  static let amber = Color.adaptive(0x875603, 0xf8c064)
  let text: String
  let color: Color
  let issues: [Issue]
  let repairedItems: Int

  init<T>(_ o: SectionOutcome<T>) {
    repairedItems = o.removed.count
    issues = o.finalReport.issues.filter { $0.severity == .fail || $0.severity == .review }
    switch o.finalReport.status {
    case .checked:
      color = Palette.pen
      switch o.finalSource {
      case .onDevice: text = "Checked on device ✓ · nothing sent"
      case .inCloud: text = "Checked in cloud ✓ · \(o.charsSentToCloud) characters sent"
      case .unknown: text = "Checks passed"
      }
    case .review:
      color = Self.amber
      text = "Needs your review"
    case .failed:
      color = Palette.rust
      switch o.finalSource {
      case .onDevice:
        text = o.escalationError == nil ? "Read on device · needs your review" : "Cloud unavailable: kept the on-device answer, please review"
      case .inCloud: text = "Read in cloud · needs your review · \(o.charsSentToCloud) characters sent"
      case .unknown: text = "Could not read this section · needs your review"
      }
    }
  }
}

struct SectionCard<Content: View>: View {
  let heading: String
  let outcome: Provenance
  @ViewBuilder let content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(heading).font(.serif(24)).foregroundStyle(Palette.ink)
      Text(outcome.text).font(.subheadline.weight(.bold)).foregroundStyle(outcome.color)
      ForEach(Array(outcome.issues.enumerated()), id: \.offset) { _, issue in
        Text("• \(issue.message)").font(.footnote).foregroundStyle(issue.severity == .review ? Provenance.amber : Palette.rust)
      }
      if outcome.repairedItems > 0 {
        Text("Dates removed by checks: \(outcome.repairedItems)").font(.footnote).foregroundStyle(Palette.muted)
      }
      content.padding(.top, 4)
    }
    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
    .background(Palette.card, in: .rect(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.line))
  }
}
