import AppKit
import CoreText

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> CGColor {
    CGColor(red: red / 255, green: green / 255, blue: blue / 255, alpha: 1)
}

func roundedRect(_ context: CGContext, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, radius: CGFloat, canvasHeight: CGFloat) {
    let rect = CGRect(x: x, y: canvasHeight - y - height, width: width, height: height)
    context.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
}

func drawText(_ text: String, x: CGFloat, baseline: CGFloat, size: CGFloat, fontName: String, fill: CGColor, in context: CGContext, canvasHeight: CGFloat) {
    let font = CTFontCreateWithName(fontName as CFString, size, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): fill
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    context.textPosition = CGPoint(x: x, y: canvasHeight - baseline)
    CTLineDraw(line, context)
}

func writePNG(_ image: CGImage, to url: URL) throws {
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "StoreArtwork", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
    }
    try data.write(to: url)
}

func drawArtwork(width: Int, height: Int, body: (CGContext) -> Void) -> CGImage {
    let space = CGColorSpaceCreateDeviceRGB()
    let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    body(context)
    return context.makeImage()!
}

let forest = color(66, 110, 88)
let forestDark = color(39, 67, 53)
let paper = color(247, 248, 244)
let cream = color(255, 255, 250)
let sage = color(224, 238, 225)
let sageDark = color(123, 158, 132)
let muted = color(112, 132, 118)
let gold = color(220, 174, 94)

let icon = drawArtwork(width: 512, height: 512) { context in
    context.setFillColor(forest)
    context.fill(CGRect(x: 0, y: 0, width: 512, height: 512))

    context.setStrokeColor(cream)
    context.setLineWidth(18)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.beginPath()
    context.move(to: CGPoint(x: 130, y: 512 - 220))
    context.addLine(to: CGPoint(x: 256, y: 512 - 112))
    context.addLine(to: CGPoint(x: 382, y: 512 - 220))
    context.move(to: CGPoint(x: 166, y: 512 - 201))
    context.addLine(to: CGPoint(x: 166, y: 512 - 369))
    context.addLine(to: CGPoint(x: 346, y: 512 - 369))
    context.addLine(to: CGPoint(x: 346, y: 512 - 201))
    context.move(to: CGPoint(x: 224, y: 512 - 369))
    context.addLine(to: CGPoint(x: 224, y: 512 - 286))
    context.addLine(to: CGPoint(x: 288, y: 512 - 286))
    context.addLine(to: CGPoint(x: 288, y: 512 - 369))
    context.strokePath()

    context.setFillColor(gold)
    context.fillEllipse(in: CGRect(x: 355, y: 512 - 144, width: 24, height: 24))
}
try writePNG(icon, to: root.appendingPathComponent("icon-512.png"))

let overviewURL = root.appendingPathComponent("screenshots/01-overview.png")
guard let source = NSImage(contentsOf: overviewURL),
      let screen = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    throw NSError(domain: "StoreArtwork", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing screenshots/01-overview.png"])
}

let feature = drawArtwork(width: 1024, height: 500) { context in
    context.setFillColor(paper)
    context.fill(CGRect(x: 0, y: 0, width: 1024, height: 500))

    context.setFillColor(sage)
    context.fillEllipse(in: CGRect(x: 675, y: 512 - 522, width: 420, height: 420))
    context.setFillColor(color(237, 228, 205))
    context.fillEllipse(in: CGRect(x: 884, y: 512 - 104, width: 82, height: 82))

    drawText("ONS HUISHOUDEN", x: 70, baseline: 96, size: 19, fontName: "AvenirNext-DemiBold", fill: forest, in: context, canvasHeight: 500)
    drawText("Samen thuis.", x: 68, baseline: 186, size: 58, fontName: "AvenirNext-DemiBold", fill: forestDark, in: context, canvasHeight: 500)
    drawText("Alles op orde.", x: 68, baseline: 253, size: 54, fontName: "AvenirNext-Regular", fill: forest, in: context, canvasHeight: 500)
    drawText("Taken, boodschappen en plannen", x: 70, baseline: 315, size: 23, fontName: "AvenirNext-Regular", fill: muted, in: context, canvasHeight: 500)
    drawText("voor een fijn thuis, samen geregeld.", x: 70, baseline: 348, size: 23, fontName: "AvenirNext-Regular", fill: muted, in: context, canvasHeight: 500)

    let tags: [(String, CGFloat, CGFloat)] = [
        ("Taken", 70, 100),
        ("Boodschappen", 184, 160),
        ("Samen thuis", 360, 150)
    ]
    for (label, x, width) in tags {
        context.setFillColor(sage)
        roundedRect(context, x: x, y: 378, width: width, height: 43, radius: 21, canvasHeight: 500)
        context.fillPath()
        drawText(label, x: x + 17, baseline: 406, size: 16, fontName: "AvenirNext-DemiBold", fill: forest, in: context, canvasHeight: 500)
    }

    let phone = CGRect(x: 690, y: 512 - 490, width: 250, height: 470)
    context.setFillColor(forestDark)
    context.addPath(CGPath(roundedRect: phone, cornerWidth: 34, cornerHeight: 34, transform: nil))
    context.fillPath()

    let screenRect = CGRect(x: 700, y: 512 - 479, width: 230, height: 448)
    context.saveGState()
    context.addPath(CGPath(roundedRect: screenRect, cornerWidth: 25, cornerHeight: 25, transform: nil))
    context.clip()
    context.draw(screen, in: screenRect)
    context.restoreGState()

    context.setFillColor(cream)
    roundedRect(context, x: 786, y: 27, width: 58, height: 8, radius: 4, canvasHeight: 500)
    context.fillPath()

    context.setStrokeColor(sageDark)
    context.setLineWidth(4)
    context.beginPath()
    context.move(to: CGPoint(x: 967, y: 512 - 319))
    context.addLine(to: CGPoint(x: 967, y: 512 - 295))
    context.move(to: CGPoint(x: 955, y: 512 - 307))
    context.addLine(to: CGPoint(x: 979, y: 512 - 307))
    context.strokePath()
}
try writePNG(feature, to: root.appendingPathComponent("feature-graphic-1024x500.png"))
