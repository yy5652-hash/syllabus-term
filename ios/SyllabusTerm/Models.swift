// The two models behind the router, both driven through Apple's LanguageModelSession:
// on device = Apple Foundation Models (SystemLanguageModel), cloud = Gemini through
// Firebase AI Logic (FirebaseAI.geminiLanguageModel). Same @Generable schema for both.
import FirebaseAILogic
import Foundation
import FoundationModels
import TermCore

@Generable struct GenComponent {
  @Guide(description: "Name of the graded component, as written in the syllabus") var name: String
  @Guide(description: "Percent of the final grade, e.g. 30 for 30%") var weight: Double
  @Guide(.anyOf(["exam", "quiz", "assignment", "project", "participation", "other"])) var kind: String
  @Guide(description: "true for extra credit that is added on top of 100%") var bonus: Bool?
}
@Generable struct GenGrading { var components: [GenComponent] }

@Generable struct GenItem {
  @Guide(description: "What is due or happening, e.g. Midterm exam") var label: String
  @Guide(description: "Date as YYYY-MM-DD") var date: String
  @Guide(.anyOf(["exam", "quiz", "deadline", "other"])) var kind: String
}
@Generable struct GenSchedule { var items: [GenItem] }

extension GradingResult {
  init(_ g: GenGrading) {
    self.init(components: g.components.map { .init(name: $0.name, weight: $0.weight, kind: $0.kind, bonus: $0.bonus) })
  }
}
extension ScheduleResult { init(_ g: GenSchedule) { self.init(items: g.items.map { .init(label: $0.label, date: $0.date, kind: $0.kind) }) } }

enum Models {
  static let cloudModelName = "gemini-3.8-flash"
  static let instructions = "You extract facts from university course syllabi. Use only what is written in the text."

  static var deviceReady: Bool { SystemLanguageModel.default.availability == .available }

  static func cloudSession() -> LanguageModelSession {
    LanguageModelSession(model: FirebaseAI.firebaseAI(backend: .googleAI()).geminiLanguageModel(name: cloudModelName),
                         instructions: instructions)
  }

  static func device<G: Generable, T: Sendable>(_ type: G.Type, _ convert: @escaping @Sendable (G) -> T) -> Runner<T> {
    { prompt in
      let r = try await LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
        .respond(to: prompt, generating: G.self)
      return (convert(r.content), .onDevice)
    }
  }

  static func cloud<G: Generable, T: Sendable>(_ type: G.Type, timeout: Duration,
                                               _ convert: @escaping @Sendable (G) -> T) -> Runner<T> {
    { prompt in
      let value = try await withCloudTimeout(timeout) {
        let response = try await cloudSession().respond(to: prompt, generating: G.self)
        return convert(response.content)
      }
      return (value, .inCloud)
    }
  }

  static func options(settings: CheckSettings, term: Term?) -> RouterOptions<GradingResult, ScheduleResult> {
    RouterOptions(
      deviceGrading: device(GenGrading.self) { GradingResult($0) },
      cloudGrading: cloud(GenGrading.self, timeout: settings.cloudTimeout) { GradingResult($0) },
      deviceSchedule: device(GenSchedule.self) { ScheduleResult($0) },
      cloudSchedule: cloud(GenSchedule.self, timeout: settings.cloudTimeout) { ScheduleResult($0) },
      escalate: settings.escalate, term: term, cloudFirst: !deviceReady)
  }

  private struct CloudTimeout: Error, CustomStringConvertible {
    var description: String { "The cloud request timed out." }
  }

  private static func withCloudTimeout<T: Sendable>(_ timeout: Duration,
                                                    operation: @escaping @Sendable () async throws -> T) async throws -> T {
    // Return the first result even if cancellation takes time inside the SDK.
    let (results, continuation) = AsyncStream<Result<T, any Error>>.makeStream(bufferingPolicy: .bufferingOldest(1))
    let deadline = ContinuousClock.now.advanced(by: timeout)
    let request = Task {
      do { continuation.yield(.success(try await operation())) }
      catch { continuation.yield(.failure(error)) }
    }
    let timer = Task {
      do {
        try await Task.sleep(until: deadline, clock: .continuous)
        continuation.yield(.failure(CloudTimeout()))
      } catch { /* The request finished first. */ }
    }
    defer {
      continuation.finish()
      request.cancel()
      timer.cancel()
    }
    var iterator = results.makeAsyncIterator()
    guard let result = await iterator.next() else { throw CancellationError() }
    return try result.get()
  }
}
