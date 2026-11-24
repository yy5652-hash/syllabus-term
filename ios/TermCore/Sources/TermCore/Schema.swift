// Structured output both models must return (mirrors web/src/core/schema.ts).

public struct GradingComponent: Codable, Equatable, Sendable {
  public var name: String
  public var weight: Double // percent, 0–100
  public var kind: String   // exam | quiz | assignment | project | participation | other
  public init(name: String, weight: Double, kind: String) { self.name = name; self.weight = weight; self.kind = kind }
}

public struct GradingResult: Codable, Equatable, Sendable {
  public var components: [GradingComponent]
  public init(components: [GradingComponent]) { self.components = components }
}

public struct DatedItem: Codable, Equatable, Sendable, Identifiable {
  public var label: String
  public var date: String // YYYY-MM-DD
  public var kind: String // exam | quiz | deadline | other
  public var id: String { "\(date)|\(label)" }
  public init(label: String, date: String, kind: String) { self.label = label; self.date = date; self.kind = kind }
}

public struct ScheduleResult: Codable, Equatable, Sendable {
  public var items: [DatedItem]
  public init(items: [DatedItem]) { self.items = items }
}

public struct Term: Equatable, Sendable {
  public var start: String // YYYY-MM-DD
  public var end: String
  public init(start: String, end: String) { self.start = start; self.end = end }
}
