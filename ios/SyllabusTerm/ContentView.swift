import FoundationModels
import SwiftUI
import TermCore
import UniformTypeIdentifiers

@MainActor @Observable final class Checker {
  enum Phase { case idle, running, done }
  var phase = Phase.idle
  var text = ""
  var title = ""
  var term: Term? = nil
  var plan: TermPlan?
  var error: String?

  func run() async {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { error = "Add a syllabus first."; return }
    error = nil; phase = .running; title = guessTitle(text)
    let escalate = await Switches.escalationEnabled()
    let year = Int(term?.start.prefix(4) ?? "") ?? Calendar.current.component(.year, from: .now)
    do {
      plan = try await extractTermPlan(text, year: year, Models.options(escalate: escalate, term: term))
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

  var body: some View {
    NavigationStack {
      ZStack { Palette.paper.ignoresSafeArea()
        switch checker.phase {
        case .idle: home
        case .running: running
        case .done: if let plan = checker.plan { ResultView(title: checker.title, plan: plan) { checker.phase = .idle } }
        }
      }
      .toolbar { ToolbarItem(placement: .principal) { Text("Syllabus → Term").font(.serif(18, .semibold)).foregroundStyle(Palette.ink) } }
      .navigationBarTitleDisplayMode(.inline)
    }
    .tint(Palette.pen)
    .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .plainText]) { result in
      do { checker.text = try SyllabusFile.text(at: result.get()); checker.term = nil }
      catch { checker.error = "This file could not be opened. Paste the text instead." }
    }
    .sheet(isPresented: $pasting) { PasteSheet(text: $checker.text) }
    #if DEBUG
    // Test hook for simulator runs without taps: `-autorunSample` checks the sample on launch.
    .task {
      print("SYLLABUSTERM device model availability: \(SystemLanguageModel.default.availability)")
      if ProcessInfo.processInfo.arguments.contains("-autorunSample") {
        checker.text = Sample.text; checker.term = Sample.term; await checker.run()
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
            Button("Try the sample") { checker.text = Sample.text; checker.term = Sample.term }
          }.font(.body.weight(.bold))
        }
        if !checker.text.isEmpty {
          VStack(alignment: .leading, spacing: 10) {
            Label { VStack(alignment: .leading) {
                Text(guessTitle(checker.text)).font(.serif(18, .semibold)).foregroundStyle(Palette.ink)
                Text("\(checker.text.count.formatted()) characters, still only on this iPhone").font(.subheadline).foregroundStyle(Palette.muted)
              } } icon: { Image(systemName: "book").foregroundStyle(Palette.pen) }
            Button("Check my syllabus") { Task { await checker.run() } }.buttonStyle(PrimaryButton())
          }
          .padding(.top, 8).overlay(alignment: .top) { Rectangle().fill(Palette.line).frame(height: 1).offset(y: -4) }
        }
        if let e = checker.error { Text(e).foregroundStyle(Palette.rust).font(.subheadline) }
        Text("On 43 real syllabi (web app): 87% of grading tables exactly right, with 3.8% of the text leaving the device. Cloud only: 85% and 23%.")
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

struct ResultView: View {
  let title: String
  let plan: TermPlan
  let back: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Button { back() } label: { Label("Check another syllabus", systemImage: "chevron.left") }.font(.subheadline.weight(.bold))
        Text(title).font(.serif(28)).foregroundStyle(Palette.ink)
        SectionCard(heading: "Grading", outcome: Provenance(plan.grading)) {
          let comps = plan.grading.value?.components ?? []
          ForEach(Array(comps.enumerated()), id: \.offset) { _, c in
            HStack { Text(c.name); Spacer(); Text("\(c.weight.formatted())%").font(.body.weight(.bold)).monospacedDigit() }
              .padding(.vertical, 6)
            Divider().overlay(Palette.line)
          }
          let sum = comps.reduce(0) { $0 + $1.weight }
          HStack { Spacer(); Text("Total \(sum.formatted())%").font(.body.weight(.bold)).foregroundStyle(abs(sum - 100) <= 0.5 ? Palette.pen : Palette.rust) }
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
            ShareLink(item: url) { Label("Add dates to Calendar", systemImage: "calendar.badge.plus") }
              .buttonStyle(PrimaryButton()).padding(.top, 8)
          }
        }
      }.padding(20)
    }
  }

  private func display(_ iso: String) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .gmt
    guard let d = f.date(from: iso) else { return iso }
    return d.formatted(.dateTime.month(.abbreviated).day())
  }
}

/// Where a section's answer came from and whether it passed its checks.
struct Provenance {
  let text: String
  let ok: Bool
  let issues: [String]
  init<T>(_ o: SectionOutcome<T>) {
    ok = o.finalReport.ok
    issues = o.finalReport.issues.filter { $0.severity == .fail }.map(\.message)
    if let e = o.escalationError, !e.isEmpty { text = "Cloud unavailable: kept the on-device answer, please review" }
    else if o.finalSource == .onDevice && o.repairedItems > 0 { text = "Checked on device ✓ · removed \(o.repairedItems) date(s) not in your syllabus" }
    else if o.finalSource == .onDevice { text = ok ? "Checked on device ✓ · nothing sent" : "Read on device · needs your review" }
    else { text = "\(ok ? "Checked in cloud ✓" : "Read in cloud · needs your review") · \(o.charsSentToCloud) characters sent" }
  }
}

struct SectionCard<Content: View>: View {
  let heading: String
  let outcome: Provenance
  @ViewBuilder let content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(heading).font(.serif(24)).foregroundStyle(Palette.ink)
      Text(outcome.text).font(.subheadline.weight(.bold)).foregroundStyle(outcome.ok ? Palette.pen : Palette.rust)
      ForEach(outcome.issues, id: \.self) { Text("• \($0)").font(.footnote).foregroundStyle(Palette.rust) }
      content.padding(.top, 4)
    }
    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
    .background(Palette.card, in: .rect(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.line))
  }
}
