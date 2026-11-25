// Structured output both models must return (mirrors web/src/core/schema.ts).

public struct GradingComponent: Codable, Equatable, Sendable {
  public var name: String
  public var weight: Double // percent, 0–100
  public var kind: String   // exam | quiz | assignment | project | participation | other
  public var bonus: Bool?
  public var points: Double?
  public init(name: String, weight: Double = 0, kind: String, bonus: Bool? = nil, points: Double? = nil) {
    self.name = name; self.weight = weight; self.kind = kind; self.bonus = bonus; self.points = points
  }

  public init(from decoder: Decoder) throws {
    let fields = try decoder.container(keyedBy: CodingKeys.self)
    points = try fields.decodeIfPresent(Double.self, forKey: .points)
    weight = try points == nil ? fields.decode(Double.self, forKey: .weight) : fields.decodeIfPresent(Double.self, forKey: .weight) ?? 0
    name = try fields.decode(String.self, forKey: .name)
    kind = try fields.decode(String.self, forKey: .kind)
    bonus = try fields.decodeIfPresent(Bool.self, forKey: .bonus)
  }
}

public struct GradingResult: Codable, Equatable, Sendable {
  public var components: [GradingComponent]
  public var totalPoints: Double?
  public init(components: [GradingComponent], totalPoints: Double? = nil) {
    self.components = components; self.totalPoints = totalPoints
  }
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
  public var label: String?
  public var start: String // YYYY-MM-DD
  public var end: String
  public init(label: String? = nil, start: String, end: String) {
    self.label = label; self.start = start; self.end = end
  }
}
