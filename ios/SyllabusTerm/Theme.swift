// Palette A, from Hokusai's Under the Wave off Kanagawa (same tokens as the web app).
import SwiftUI

extension Color {
  init(hex: UInt32) { self.init(red: Double(hex >> 16 & 0xff) / 255, green: Double(hex >> 8 & 0xff) / 255, blue: Double(hex & 0xff) / 255) }
  static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
  }
}

enum Palette {
  static let paper = Color.adaptive(0xf3ecdc, 0x16202f)
  static let card = Color.adaptive(0xfffbf2, 0x1f2c3e)
  static let ink = Color.adaptive(0x1b2a3e, 0xf3ead6)
  static let muted = Color.adaptive(0x4f5b66, 0xbdb4a0)
  static let pen = Color.adaptive(0x2b4a7c, 0xa9c0de)       // Prussian blue: annotations, focus
  static let action = Color.adaptive(0x2b4a7c, 0xfdf4dc)    // primary button
  static let onAction = Color.adaptive(0xfffbf2, 0x1b2a3e)
  static let foam = Color(hex: 0x7f95ae)
  static let line = Color.adaptive(0xe2d6bd, 0x2f3e55)
  static let rust = Color.adaptive(0x9e4427, 0xe8977a)      // a failed check, never decoration
}

extension Font {
  static func serif(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font { .system(size: size, weight: weight, design: .serif) }
}

struct PrimaryButton: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.body.weight(.bold)).frame(maxWidth: .infinity, minHeight: 50)
      .background(Palette.action.opacity(configuration.isPressed ? 0.85 : 1), in: .rect(cornerRadius: 12))
      .foregroundStyle(Palette.onAction)
  }
}
