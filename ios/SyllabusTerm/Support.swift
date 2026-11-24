import Foundation
import PDFKit
import TermCore

enum Sample {
  static let text = """
  ECON-UA 2 Principles of Macroeconomics — Fall 2026
  Grading
  Problem sets 25%
  Midterm exam 30%
  Final exam 30 percent
  Participation 15%
  Schedule
  Problem set 1 due Sept. 17
  Midterm exam: Thursday, October 15th
  10/29 Problem set 2 due
  Final exam December 17
  """
  static let term = Term(start: "2026-09-01", end: "2026-12-23")
}

enum SyllabusFile {
  /// Text of a PDF or plain-text file, read on the device.
  static func text(at url: URL) throws -> String {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    if url.pathExtension.lowercased() == "pdf" {
      guard let doc = PDFDocument(url: url) else { throw CocoaError(.fileReadCorruptFile) }
      return (0..<doc.pageCount).compactMap { doc.page(at: $0)?.string }.joined(separator: "\n")
    }
    return try String(contentsOf: url, encoding: .utf8)
  }
}

/// Course title from the line carrying a course code (same rule as web/src/app/title.ts).
func guessTitle(_ text: String) -> String {
  let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(20)
  let code = #"\b(?:[A-Z]{2,6}(?:[- ][A-Z]{1,3})?[- ]?\d{1,4}[A-Z]?|\d{1,2}\.\d{2,4}[A-Z]?)\b"#
  let pick = lines.first { $0.count <= 140 && $0.range(of: code, options: .regularExpression) != nil } ?? lines.first { $0.count >= 6 }
  return String((pick ?? "Untitled course").prefix(90))
}

enum Calendar_ {
  /// An .ics file with one all-day event per dated item.
  static func ics(title: String, items: [DatedItem]) -> URL? {
    let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: "[-:]", with: "", options: .regularExpression)
    let esc = { (s: String) in s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: ",", with: "\\,").replacingOccurrences(of: ";", with: "\\;") }
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Syllabus to Term//EN", "CALSCALE:GREGORIAN"]
    for it in items where isRealDate(it.date) {
      let d = it.date.replacingOccurrences(of: "-", with: "")
      lines += ["BEGIN:VEVENT", "UID:\(UUID().uuidString)@syllabusterm", "DTSTAMP:\(stamp)", "DTSTART;VALUE=DATE:\(d)",
                "SUMMARY:\(esc(it.label)) · \(esc(title))", "END:VEVENT"]
    }
    lines.append("END:VCALENDAR")
    let url = FileManager.default.temporaryDirectory.appending(path: "term-dates.ics")
    do { try lines.joined(separator: "\r\n").write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
  }
}
