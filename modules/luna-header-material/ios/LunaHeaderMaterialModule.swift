import ExpoModulesCore
import UIKit

public final class LunaHeaderMaterialModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LunaHeaderMaterial")

    Constant("isAvailable") { true }
    Constant("progressiveRendererVersion") { 3 }

    View(LunaHeaderMaterialView.self) {
      Prop("fadeHeight") { (view, value: CGFloat) in
        view.fadeHeight = value.isFinite ? max(0, value) : 0
      }
      Prop("topRadius") { (view, value: CGFloat) in
        view.topRadius = value.isFinite ? max(0, value) : 0
      }
      Prop("colorScheme") { (view, value: String) in
        view.overrideUserInterfaceStyle = value == "dark" ? .dark : .light
      }
      Prop("scrollViewTag") { (view, value: Int?) in view.scrollViewTag = value }
      Prop("enabled") { (view, value: Bool) in view.enabled = value }
      Prop("reducedTransparency") { (view, value: Bool) in view.reducedTransparency = value }
      Prop("opaqueColor") { (view, value: UIColor) in view.opaqueColor = value }
      Prop("windowAligned") { (view, value: Bool) in view.windowAligned = value }
      Prop("protectedHeight") { (view, value: CGFloat) in
        view.protectedHeight = value.isFinite ? max(0, value) : 0
      }
    }
  }
}

final class LunaHeaderMaterialView: ExpoView {
  // Blur and foreground attenuation are separate. Masking only the blur leaves
  // the original sharp text visible and regular material lifts a black page.
  private let material = UIVisualEffectView(effect: UIBlurEffect(style: .regular))
  private let fadeMask = UIView()
  private let gradient = CAGradientLayer()
  private let surfaceFade = CAGradientLayer()
  private weak var observedScrollView: UIScrollView?
  private var offsetObservation: NSKeyValueObservation?
  private var insetObservation: NSKeyValueObservation?
  private var bindingRevision = 0
  private struct MaskState: Equatable {
    let size: CGSize
    let strength: CGFloat
    let fadeHeight: CGFloat
    let topRadius: CGFloat
  }
  private var lastMaskState: MaskState?

  var fadeHeight: CGFloat = 64 { didSet { setNeedsLayout() } }
  var topRadius: CGFloat = 0 { didSet { setNeedsLayout() } }
  var protectedHeight: CGFloat = 0 { didSet { setNeedsLayout() } }
  var windowAligned = false { didSet { setNeedsLayout() } }
  var scrollViewTag: Int? { didSet { if scrollViewTag != oldValue { reconnect() } } }
  var enabled = true { didSet { if enabled != oldValue { reconnect() } } }
  var reducedTransparency = false {
    didSet {
      lastMaskState = nil
      material.effect = reducedTransparency ? nil : UIBlurEffect(style: .regular)
      material.backgroundColor = reducedTransparency ? opaqueColor : .clear
      updateMask()
    }
  }
  var opaqueColor = UIColor.systemBackground {
    didSet {
      if reducedTransparency { material.backgroundColor = opaqueColor }
      lastMaskState = nil
      updateMask()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    backgroundColor = .clear
    material.isUserInteractionEnabled = false
    fadeMask.isUserInteractionEnabled = false
    fadeMask.layer.addSublayer(gradient)
    // Mask the effect view itself. Masking an ancestor breaks UIKit's backdrop sampling.
    material.mask = fadeMask
    addSubview(material)
    // A foreground gradient fades the complete rendered result to the page.
    // Do not mask an ancestor: UIKit does not support that for visual effects.
    layer.addSublayer(surfaceFade)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reconnect()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateMask()
  }

  private func updateMaterialFrame() {
    if windowAligned, let window {
      let origin = convert(CGPoint.zero, to: window)
      // Native navigation bars live outside the React content. The material is a
      // sibling of the scroller, so its fade is not clipped by the bar background.
      material.frame = CGRect(x: -origin.x, y: -origin.y, width: window.bounds.width,
                              height: navigationBarBottom(in: window) + fadeHeight)
    } else {
      material.frame = bounds
    }
    surfaceFade.frame = material.frame
  }

  private func navigationBarBottom(in window: UIWindow) -> CGFloat {
    // HeaderHeightContext is local to a sheet. UIKit supplies its actual window
    // position, including the sheet origin and grabber, without guessed offsets.
    var responder: UIResponder? = (observedScrollView as UIResponder?) ?? self
    while let current = responder {
      if let controller = current as? UIViewController,
         let bar = controller.navigationController?.navigationBar,
         !bar.isHidden, bar.window === window {
        let bottom = bar.convert(bar.bounds, to: window).maxY
        if bottom.isFinite, bottom > 0 { return bottom }
      }
      responder = current.next
    }
    return protectedHeight
  }

  private func updateMask() {
    updateMaterialFrame()
    var strength: CGFloat = 0
    if enabled, reducedTransparency, window != nil {
      strength = 1
    } else if enabled, let scrollView = observedScrollView, window != nil {
      var distance = max(0, scrollView.contentOffset.y + scrollView.adjustedContentInset.top)
      if scrollView.isPagingEnabled, scrollView.bounds.height > 0 {
        // Virtualized calendars rest many pages from offset zero. A settled page
        // still needs clear glass, with no material tint on its empty background.
        let pageHeight = scrollView.bounds.height
        distance = abs(distance - (distance / pageHeight).rounded() * pageHeight)
      }
      let progress = min(1, distance / 16)
      strength = progress * progress * (3 - 2 * progress)
      if windowAligned, let window {
        let scrollFrame = scrollView.convert(scrollView.bounds, to: window)
        // A fixed calendar preview may place its controls below the navigation
        // bar. Those controls never pass behind the title and need no overlay.
        if scrollFrame.minY >= navigationBarBottom(in: window) { strength = 0 }
      }
    }
    let state = MaskState(size: material.bounds.size, strength: strength,
                          fadeHeight: fadeHeight, topRadius: topRadius)
    guard state != lastMaskState else { return }
    lastMaskState = state
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fadeMask.frame = material.bounds
    gradient.frame = fadeMask.bounds
    gradient.startPoint = CGPoint(x: 0.5, y: 0)
    gradient.endPoint = CGPoint(x: 0.5, y: 1)
    let height = max(1, material.bounds.height)
    let fadeStart = max(0, height - fadeHeight - 12)
    let alphas: [CGFloat] = [1, 1, 0.96, 0.78, 0.5, 0.22, 0.04, 0]
    let positions: [CGFloat] = [0, fadeStart, fadeStart + (height - fadeStart) * 0.16,
      fadeStart + (height - fadeStart) * 0.32, fadeStart + (height - fadeStart) * 0.5,
      fadeStart + (height - fadeStart) * 0.68, fadeStart + (height - fadeStart) * 0.84, height]
    gradient.colors = alphas.map { UIColor.black.withAlphaComponent($0 * strength).cgColor }
    gradient.locations = positions.map { NSNumber(value: Double($0 / height)) }
    surfaceFade.startPoint = gradient.startPoint
    surfaceFade.endPoint = gradient.endPoint
    surfaceFade.locations = gradient.locations
    surfaceFade.colors = alphas.map { opaqueColor.withAlphaComponent($0 * strength).cgColor }
    surfaceFade.isHidden = reducedTransparency
    surfaceFade.cornerRadius = topRadius
    surfaceFade.cornerCurve = .continuous
    surfaceFade.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
    surfaceFade.masksToBounds = topRadius > 0
    material.layer.cornerRadius = topRadius
    material.layer.cornerCurve = .continuous
    material.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
    material.clipsToBounds = topRadius > 0
    // UIKit copies an effect view's mask. Reassign it after every bounds/gradient update.
    material.mask = nil
    material.mask = fadeMask
    CATransaction.commit()
  }

  private func reconnect() {
    bindingRevision += 1
    offsetObservation = nil
    insetObservation = nil
    observedScrollView = nil
    updateMask()
    guard enabled, window != nil, scrollViewTag != nil else { return }
    resolveTarget(revision: bindingRevision, attempt: 0)
  }

  private func resolveTarget(revision: Int, attempt: Int) {
    guard revision == bindingRevision, enabled, window != nil, let tag = scrollViewTag else { return }
    if let node = appContext?.findView(withTag: tag, ofType: UIView.self),
       let scrollView = findScrollView(node) {
      observedScrollView = scrollView
      offsetObservation = scrollView.observe(\.contentOffset, options: [.initial, .new]) { [weak self] _, _ in
        self?.updateMask()
      }
      insetObservation = scrollView.observe(\.contentInset, options: [.new]) { [weak self] _, _ in
        self?.updateMask()
      }
      return
    }
    guard attempt < 30 else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
      self?.resolveTarget(revision: revision, attempt: attempt + 1)
    }
  }

  private func findScrollView(_ view: UIView) -> UIScrollView? {
    if let scrollView = view as? UIScrollView { return scrollView }
    for child in view.subviews {
      if let scrollView = findScrollView(child) { return scrollView }
    }
    return nil
  }
}
