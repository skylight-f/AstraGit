import AppKit
import Foundation

// 使用显式像素画布，避免 Retina 屏幕使输出尺寸翻倍。
let arguments = CommandLine.arguments
guard arguments.count == 4, let size = Int(arguments[3]), size > 0,
      let source = NSImage(contentsOfFile: arguments[1]),
      let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                    isPlanar: false, colorSpaceName: .deviceRGB,
                                    bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("无法读取图标 SVG 或创建 PNG 画布。")
}
bitmap.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
context.imageInterpolation = .high
source.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero,
            operation: .sourceOver, fraction: 1)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let bytes = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("图标 PNG 编码失败。")
}
try bytes.write(to: URL(fileURLWithPath: arguments[2]), options: .atomic)
