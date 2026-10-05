"""High-fidelity iOS preview renderer.

Each fragment is:
  - Wrapped in <div class="hf-ios-<optid>"> so sibling cards cannot collide.
  - Inline <style> with every selector prefixed .hf-ios-<optid> .
  - @keyframes renamed to hf-ios-<optid>-<name> to avoid global name clashes.
  - Interactive JS handlers (onmousedown/onmouseup) removed; press feel is
    conveyed via CSS :active rules or infinite-keyframe demo animations.
  - tokens['color']['accent'] substituted where the source hardcodes the iOS
    blue (#007AFF / #0A84FF) or the prototype purple (#7c6bf8), when provided.

Public API
----------
render_ios_high_fi(option_id, tokens=None) -> str | None
has_ios_high_fi(option_id) -> bool
IOS_HIGH_FI_IDS: frozenset[str]
"""

from __future__ import annotations

# ── The 52 IDs that have a high-fi renderer ──────────────────────────────────
IOS_HIGH_FI_IDS: frozenset[str] = frozenset({
    "press-scale-down",
    "press-opacity-dim",
    "press-highlight-bg",
    "press-ripple",
    "btn-flat",
    "btn-soft-shadow",
    "btn-inner-highlight",
    "btn-glass",
    "transition-push-slide",
    "transition-hero-expand",
    "transition-fade",
    "transition-sheet-up",
    "ptr-native-spinner",
    "ptr-progress-arc",
    "ptr-logo-morph",
    "skeleton-shimmer-ltr",
    "skeleton-pulse",
    "skeleton-blur",
    "gradient-linear",
    "gradient-mesh",
    "gradient-duotone",
    "gradient-none",
    "dark-true-black",
    "dark-elevated-layers",
    "dark-deep-color",
    "dark-glass-layers",
    "accent-cta-only",
    "accent-semantic",
    "accent-expressive",
    "icon-instant-swap",
    "icon-spring-bounce",
    "icon-morph-fill",
    "icon-lottie-rive",
    "haptic-minimal",
    "haptic-standard-vocab",
    "haptic-expressive",
    "onboard-slide-parallax",
    "onboard-lottie-scenes",
    "onboard-morph-shapes",
    "onboard-stagger-entry",
    "celebrate-confetti",
    "celebrate-checkmark-ripple",
    "celebrate-full-screen",
    "celebrate-score-glow",
    "splash-fade-in",
    "splash-logo-build",
    "splash-morph-ui",
    "splash-ambient-particle",
    "scroll-system",
    "scroll-sticky-headers",
    "scroll-parallax-bg",
    "scroll-snap-cards",
})


def _accent(tokens: dict | None, fallback: str = "#007AFF") -> str:
    """Return the accent color from tokens or the given fallback."""
    try:
        return tokens["color"]["accent"]  # type: ignore[index]
    except (TypeError, KeyError):
        return fallback


def _purple(tokens: dict | None) -> str:
    """Prototype purple accent (#7c6bf8), overridable via tokens."""
    return _accent(tokens, fallback="#7c6bf8")


# ── Individual renderers ──────────────────────────────────────────────────────

def _press_scale_down(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "press-scale-down"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .ps-wrap {{
  width:200px;height:140px;display:flex;flex-direction:column;
  gap:10px;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .ps-btn {{
  height:40px;padding:0 20px;border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;cursor:pointer;user-select:none;
  background:{p};color:#fff;
  animation:hf-ios-{uid}-press-pulse 2s cubic-bezier(0.34,1.56,0.64,1) infinite;
}}
.hf-ios-{uid} .ps-row {{
  width:170px;height:36px;background:#fff;border-radius:8px;
  display:flex;align-items:center;padding:0 10px;
  font-size:11px;color:#000;
  animation:hf-ios-{uid}-row-pulse 2s 0.3s cubic-bezier(0.34,1.56,0.64,1) infinite;
}}
.hf-ios-{uid} .ps-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
@keyframes hf-ios-{uid}-press-pulse {{
  0%,100%{{transform:scale(1)}} 30%{{transform:scale(0.95)}} 60%{{transform:scale(1.02)}}
}}
@keyframes hf-ios-{uid}-row-pulse {{
  0%,100%{{transform:scale(1)}} 30%{{transform:scale(0.97)}} 60%{{transform:scale(1.01)}}
}}
</style>
<div class="ps-wrap">
  <div class="ps-btn">Hold to Feel</div>
  <div class="ps-row">List row — press &amp; hold</div>
  <div class="ps-hint">scale(0.95) + spring return</div>
</div>
</div>"""


def _press_opacity_dim(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "press-opacity-dim"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .po-wrap {{
  width:200px;height:140px;display:flex;flex-direction:column;
  gap:10px;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .po-btn {{
  height:40px;padding:0 20px;border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;
  background:{p};color:#fff;
  animation:hf-ios-{uid}-dim 2s ease-in-out infinite;
}}
.hf-ios-{uid} .po-row {{
  width:170px;height:36px;background:#fff;border-radius:8px;
  display:flex;align-items:center;padding:0 10px;
  font-size:11px;color:#000;
  animation:hf-ios-{uid}-dim 2s 0.4s ease-in-out infinite;
}}
.hf-ios-{uid} .po-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
@keyframes hf-ios-{uid}-dim {{
  0%,100%{{opacity:1}} 40%,60%{{opacity:0.45}}
}}
</style>
<div class="po-wrap">
  <div class="po-btn">Hold to Feel</div>
  <div class="po-row">List row — press &amp; hold</div>
  <div class="po-hint">opacity → 0.45 on press</div>
</div>
</div>"""


def _press_highlight_bg(tokens: dict | None) -> str:
    uid = "press-highlight-bg"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .ph-wrap {{
  width:200px;height:140px;display:flex;flex-direction:column;
  gap:8px;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .ph-row {{
  width:172px;height:36px;border-radius:8px;
  display:flex;align-items:center;padding:0 10px;
  font-size:11px;color:#000;
}}
.hf-ios-{uid} .ph-row-1 {{
  animation:hf-ios-{uid}-highlight 2s ease-in-out infinite;
}}
.hf-ios-{uid} .ph-row-2, .hf-ios-{uid} .ph-row-3 {{background:#fff;}}
@keyframes hf-ios-{uid}-highlight {{
  0%,100%{{background:#fff}} 30%,60%{{background:#d1d1d6}}
}}
</style>
<div class="ph-wrap">
  <div class="ph-row ph-row-1">Hold — watch highlight</div>
  <div class="ph-row ph-row-2">Another row</div>
  <div class="ph-row ph-row-3">Another row</div>
</div>
</div>"""


def _press_ripple(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "press-ripple"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .pr-wrap {{
  width:200px;height:140px;display:flex;flex-direction:column;
  gap:10px;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .pr-btn {{
  width:120px;height:44px;background:{p};border-radius:10px;
  position:relative;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;color:#fff;
}}
.hf-ios-{uid} .pr-circle {{
  position:absolute;border-radius:50%;
  background:rgba(255,255,255,0.35);
  width:80px;height:80px;
  left:50%;top:50%;
  transform:translate(-50%,-50%) scale(0);
  animation:hf-ios-{uid}-ripple 2s ease-out infinite;
  pointer-events:none;
}}
.hf-ios-{uid} .pr-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
@keyframes hf-ios-{uid}-ripple {{
  0%{{transform:translate(-50%,-50%) scale(0);opacity:1}}
  70%{{transform:translate(-50%,-50%) scale(2.5);opacity:0}}
  100%{{transform:translate(-50%,-50%) scale(2.5);opacity:0}}
}}
</style>
<div class="pr-wrap">
  <div class="pr-btn">
    <div class="pr-circle"></div>
    Click Me
  </div>
  <div class="pr-hint">Ripple from click origin</div>
</div>
</div>"""


def _btn_flat(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "btn-flat"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .bf-wrap {{
  display:flex;flex-direction:column;gap:10px;align-items:center;
}}
.hf-ios-{uid} .bf-bg {{
  background:#f2f2f7;border-radius:12px;padding:16px 20px;
  display:flex;flex-direction:column;gap:8px;align-items:center;
}}
.hf-ios-{uid} .bf-btn {{
  height:40px;padding:0 24px;border-radius:10px;
  font-size:12px;font-weight:600;cursor:default;border:none;
  display:flex;align-items:center;justify-content:center;
  color:#fff;
}}
.hf-ios-{uid} .bf-blue {{background:{p};}}
.hf-ios-{uid} .bf-green {{background:#34c759;}}
.hf-ios-{uid} .bf-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
</style>
<div class="bf-wrap">
  <div class="bf-bg">
    <button class="bf-btn bf-blue">Confirm Payment</button>
    <button class="bf-btn bf-green">Complete</button>
  </div>
  <div class="bf-hint">No shadow — color carries affordance</div>
</div>
</div>"""


def _btn_soft_shadow(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "btn-soft-shadow"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .bss-wrap {{
  display:flex;flex-direction:column;gap:10px;align-items:center;
}}
.hf-ios-{uid} .bss-bg {{
  background:#f2f2f7;border-radius:12px;padding:16px 20px;
  display:flex;flex-direction:column;gap:8px;align-items:center;
}}
.hf-ios-{uid} .bss-btn {{
  height:40px;padding:0 24px;border-radius:10px;
  font-size:12px;font-weight:600;cursor:default;border:none;
  display:flex;align-items:center;justify-content:center;
  color:#fff;
}}
.hf-ios-{uid} .bss-blue {{background:{p};box-shadow:0 6px 20px rgba(0,122,255,0.45);}}
.hf-ios-{uid} .bss-green {{background:#34c759;box-shadow:0 6px 20px rgba(52,199,89,0.45);}}
.hf-ios-{uid} .bss-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
</style>
<div class="bss-wrap">
  <div class="bss-bg">
    <button class="bss-btn bss-blue">Confirm Payment</button>
    <button class="bss-btn bss-green">Complete</button>
  </div>
  <div class="bss-hint">Colored shadow = lift</div>
</div>
</div>"""


def _btn_inner_highlight(tokens: dict | None) -> str:
    uid = "btn-inner-highlight"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .bih-wrap {{
  display:flex;flex-direction:column;gap:10px;align-items:center;
}}
.hf-ios-{uid} .bih-bg {{
  background:#f2f2f7;border-radius:12px;padding:16px 20px;
  display:flex;flex-direction:column;gap:8px;align-items:center;
}}
.hf-ios-{uid} .bih-btn {{
  height:40px;padding:0 24px;border-radius:10px;
  font-size:12px;font-weight:600;cursor:default;border:none;
  display:flex;align-items:center;justify-content:center;
  color:#fff;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.25),inset 0 -1px 0 rgba(0,0,0,0.15);
}}
.hf-ios-{uid} .bih-blue {{background:linear-gradient(180deg,#2a9fff 0%,#006ee3 100%);}}
.hf-ios-{uid} .bih-green {{background:linear-gradient(180deg,#3dd68c 0%,#26a65b 100%);}}
.hf-ios-{uid} .bih-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
</style>
<div class="bih-wrap">
  <div class="bih-bg">
    <button class="bih-btn bih-blue">Confirm Payment</button>
    <button class="bih-btn bih-green">Complete</button>
  </div>
  <div class="bih-hint">Inner rim = tactile feel</div>
</div>
</div>"""


def _btn_glass(tokens: dict | None) -> str:
    uid = "btn-glass"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .bg-wrap {{
  display:flex;flex-direction:column;gap:10px;align-items:center;
}}
.hf-ios-{uid} .bg-surface {{
  width:200px;height:120px;
  background:linear-gradient(135deg,#4a5568 0%,#1a202c 100%);
  border-radius:12px;
  display:flex;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .bg-inner {{
  display:flex;flex-direction:column;gap:8px;align-items:center;
}}
.hf-ios-{uid} .bg-btn {{
  height:40px;padding:0 24px;border-radius:10px;
  font-size:12px;font-weight:600;cursor:default;border:none;
  display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,0.15);color:#fff;
  backdrop-filter:blur(16px);
  border:1px solid rgba(255,255,255,0.25);
}}
.hf-ios-{uid} .bg-hint {{font-size:10px;color:#8e8e93;text-align:center;}}
</style>
<div class="bg-wrap">
  <div class="bg-surface">
    <div class="bg-inner">
      <button class="bg-btn">Open Settings</button>
      <button class="bg-btn">Share</button>
    </div>
  </div>
  <div class="bg-hint">Frosted glass, content-adaptive</div>
</div>
</div>"""


def _transition_push_slide(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "transition-push-slide"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .tps-wrap {{
  width:220px;height:160px;position:relative;overflow:hidden;
  border-radius:12px;background:#f2f2f7;
}}
.hf-ios-{uid} .tps-behind {{
  position:absolute;inset:0;background:#e8e8ed;border-radius:12px;
  display:flex;flex-direction:column;padding:10px;gap:6px;
  animation:hf-ios-{uid}-push-behind 0.5s cubic-bezier(0.4,0,0.2,1) infinite alternate;
}}
.hf-ios-{uid} .tps-front {{
  position:absolute;inset:0;background:#fff;border-radius:12px;
  padding:10px;display:flex;flex-direction:column;gap:6px;
  animation:hf-ios-{uid}-push-in 0.5s cubic-bezier(0.4,0,0.2,1) infinite alternate;
}}
.hf-ios-{uid} .tps-bar-h {{height:14px;background:#c7c7cc;border-radius:4px;width:50%;}}
.hf-ios-{uid} .tps-bar {{height:10px;background:#c7c7cc;border-radius:4px;}}
.hf-ios-{uid} .tps-bar-70 {{height:10px;background:#c7c7cc;border-radius:4px;width:70%;}}
.hf-ios-{uid} .tps-back-lnk {{display:flex;align-items:center;gap:6px;margin-bottom:4px;color:{p};font-size:11px;}}
.hf-ios-{uid} .tps-fbar-h {{height:14px;background:#e5e5ea;border-radius:4px;width:60%;}}
.hf-ios-{uid} .tps-fbar {{height:10px;background:#e5e5ea;border-radius:4px;}}
.hf-ios-{uid} .tps-fbar-80 {{height:10px;background:#e5e5ea;border-radius:4px;width:80%;}}
@keyframes hf-ios-{uid}-push-in {{
  0%{{transform:translateX(100%)}} 100%{{transform:translateX(0)}}
}}
@keyframes hf-ios-{uid}-push-behind {{
  0%{{transform:translateX(0)}} 100%{{transform:translateX(-30%)}}
}}
</style>
<div class="tps-wrap">
  <div class="tps-behind">
    <div class="tps-bar-h"></div>
    <div class="tps-bar"></div>
    <div class="tps-bar-70"></div>
  </div>
  <div class="tps-front">
    <div class="tps-back-lnk">&#8249; Back</div>
    <div class="tps-fbar-h"></div>
    <div class="tps-fbar"></div>
    <div class="tps-fbar-80"></div>
  </div>
</div>
</div>"""


def _transition_hero_expand(tokens: dict | None) -> str:
    uid = "transition-hero-expand"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .the-wrap {{
  width:220px;height:160px;position:relative;overflow:hidden;
  border-radius:12px;background:#f2f2f7;
}}
.hf-ios-{uid} .the-grid {{
  position:absolute;inset:0;padding:10px;
  display:flex;gap:6px;flex-wrap:wrap;align-content:flex-start;
}}
.hf-ios-{uid} .the-hero {{
  width:90px;height:65px;
  background:linear-gradient(135deg,#667eea,#764ba2);
  border-radius:10px;
  position:relative;z-index:1;
  animation:hf-ios-{uid}-hero-expand 2.5s cubic-bezier(0.4,0,0.2,1) infinite alternate;
}}
.hf-ios-{uid} .the-card {{
  width:90px;height:65px;background:#e5e5ea;border-radius:10px;
}}
@keyframes hf-ios-{uid}-hero-expand {{
  0%,30%{{transform:scale(1);border-radius:10px;z-index:0}}
  70%,100%{{transform:scale(2.5);border-radius:14px;z-index:10;transform-origin:top left;}}
}}
</style>
<div class="the-wrap">
  <div class="the-grid">
    <div class="the-hero"></div>
    <div class="the-card"></div>
    <div class="the-card"></div>
    <div class="the-card"></div>
  </div>
</div>
</div>"""


def _transition_fade(tokens: dict | None) -> str:
    uid = "transition-fade"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .tf-wrap {{
  width:220px;height:160px;position:relative;overflow:hidden;
  border-radius:12px;background:#f2f2f7;
}}
.hf-ios-{uid} .tf-a {{
  position:absolute;inset:0;background:#e8e8ed;border-radius:12px;
  padding:10px;display:flex;flex-direction:column;gap:6px;
  animation:hf-ios-{uid}-fade-a 2s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .tf-b {{
  position:absolute;inset:0;background:#fff;border-radius:12px;
  padding:10px;display:flex;flex-direction:column;gap:6px;
  animation:hf-ios-{uid}-fade-b 2s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .tf-row-g {{height:12px;background:#c7c7cc;border-radius:4px;width:55%;}}
.hf-ios-{uid} .tf-row-g2 {{height:10px;background:#c7c7cc;border-radius:4px;}}
.hf-ios-{uid} .tf-row-w {{height:12px;background:#e5e5ea;border-radius:4px;width:70%;}}
.hf-ios-{uid} .tf-row-w2 {{height:10px;background:#e5e5ea;border-radius:4px;}}
.hf-ios-{uid} .tf-row-w3 {{height:10px;background:#e5e5ea;border-radius:4px;width:60%;}}
@keyframes hf-ios-{uid}-fade-a {{
  0%,40%{{opacity:1}} 70%,100%{{opacity:0}}
}}
@keyframes hf-ios-{uid}-fade-b {{
  0%,40%{{opacity:0}} 70%,100%{{opacity:1}}
}}
</style>
<div class="tf-wrap">
  <div class="tf-a">
    <div class="tf-row-g"></div>
    <div class="tf-row-g2"></div>
  </div>
  <div class="tf-b">
    <div class="tf-row-w"></div>
    <div class="tf-row-w2"></div>
    <div class="tf-row-w3"></div>
  </div>
</div>
</div>"""


def _transition_sheet_up(tokens: dict | None) -> str:
    uid = "transition-sheet-up"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .tsu-wrap {{
  width:220px;height:160px;position:relative;overflow:hidden;
  border-radius:12px;background:#f2f2f7;
}}
.hf-ios-{uid} .tsu-scrim {{
  position:absolute;inset:0;border-radius:12px;
  animation:hf-ios-{uid}-scrim 2.5s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .tsu-sheet {{
  position:absolute;left:0;right:0;bottom:0;
  background:#fff;border-radius:12px 12px 0 0;padding:10px;
  animation:hf-ios-{uid}-sheet-up 2.5s cubic-bezier(0.34,1.3,0.64,1) infinite alternate;
}}
.hf-ios-{uid} .tsu-handle {{
  width:32px;height:4px;background:#c7c7cc;border-radius:2px;
  margin:0 auto 8px;
}}
.hf-ios-{uid} .tsu-r1 {{height:12px;background:#e5e5ea;border-radius:4px;width:60%;margin-bottom:6px;}}
.hf-ios-{uid} .tsu-r2 {{height:10px;background:#e5e5ea;border-radius:4px;margin-bottom:6px;}}
.hf-ios-{uid} .tsu-r3 {{height:10px;background:#e5e5ea;border-radius:4px;width:75%;}}
@keyframes hf-ios-{uid}-sheet-up {{
  0%,20%{{transform:translateY(100%)}} 60%,100%{{transform:translateY(0)}}
}}
@keyframes hf-ios-{uid}-scrim {{
  0%,20%{{background:rgba(0,0,0,0)}} 60%,100%{{background:rgba(0,0,0,0.3)}}
}}
</style>
<div class="tsu-wrap">
  <div class="tsu-scrim"></div>
  <div class="tsu-sheet">
    <div class="tsu-handle"></div>
    <div class="tsu-r1"></div>
    <div class="tsu-r2"></div>
    <div class="tsu-r3"></div>
  </div>
</div>
</div>"""


def _ptr_native_spinner(tokens: dict | None) -> str:
    uid = "ptr-native-spinner"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .pns-wrap {{
  width:200px;height:140px;background:#f2f2f7;border-radius:12px;
  overflow:hidden;display:flex;flex-direction:column;align-items:center;
  position:relative;
}}
.hf-ios-{uid} .pns-indicator {{
  height:40px;display:flex;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .pns-spinner {{
  width:20px;height:20px;border:2px solid #c7c7cc;
  border-top-color:#8e8e93;border-radius:50%;
  animation:hf-ios-{uid}-spin 1s linear infinite;
}}
.hf-ios-{uid} .pns-rows {{
  padding:0 10px;display:flex;flex-direction:column;gap:6px;width:100%;
}}
.hf-ios-{uid} .pns-row {{height:22px;background:#fff;border-radius:6px;}}
.hf-ios-{uid} .pns-row-short {{height:22px;background:#fff;border-radius:6px;width:70%;}}
@keyframes hf-ios-{uid}-spin {{to{{transform:rotate(360deg)}}}}
</style>
<div class="pns-wrap">
  <div class="pns-indicator"><div class="pns-spinner"></div></div>
  <div class="pns-rows">
    <div class="pns-row"></div>
    <div class="pns-row-short"></div>
    <div class="pns-row"></div>
  </div>
</div>
</div>"""


def _ptr_progress_arc(tokens: dict | None) -> str:
    p = _accent(tokens, "#007AFF")
    uid = "ptr-progress-arc"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .ppa-wrap {{
  width:200px;height:140px;background:#f2f2f7;border-radius:12px;
  overflow:hidden;display:flex;flex-direction:column;align-items:center;
  position:relative;
}}
.hf-ios-{uid} .ppa-indicator {{
  height:40px;display:flex;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .ppa-svg {{width:28px;height:28px;}}
.hf-ios-{uid} .ppa-bg {{fill:none;stroke:#ddd;stroke-width:3;}}
.hf-ios-{uid} .ppa-fill {{
  fill:none;stroke:{p};stroke-width:3;stroke-linecap:round;
  stroke-dasharray:50;stroke-dashoffset:12;
  transform:rotate(-90deg);transform-origin:50% 50%;
  animation:hf-ios-{uid}-arc-draw 1.5s ease-in-out infinite;
}}
.hf-ios-{uid} .ppa-rows {{
  padding:0 10px;display:flex;flex-direction:column;gap:6px;width:100%;
}}
.hf-ios-{uid} .ppa-row {{height:22px;background:#fff;border-radius:6px;}}
.hf-ios-{uid} .ppa-row-short {{height:22px;background:#fff;border-radius:6px;width:70%;}}
@keyframes hf-ios-{uid}-arc-draw {{
  0%{{stroke-dashoffset:50}} 50%{{stroke-dashoffset:5}} 100%{{stroke-dashoffset:50}}
}}
</style>
<div class="ppa-wrap">
  <div class="ppa-indicator">
    <svg class="ppa-svg" viewBox="0 0 28 28">
      <circle class="ppa-bg" cx="14" cy="14" r="11"/>
      <circle class="ppa-fill" cx="14" cy="14" r="11"/>
    </svg>
  </div>
  <div class="ppa-rows">
    <div class="ppa-row"></div>
    <div class="ppa-row-short"></div>
    <div class="ppa-row"></div>
  </div>
</div>
</div>"""


def _ptr_logo_morph(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "ptr-logo-morph"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .plm-wrap {{
  width:200px;height:140px;background:#f2f2f7;border-radius:12px;
  overflow:hidden;display:flex;flex-direction:column;align-items:center;
  position:relative;
}}
.hf-ios-{uid} .plm-indicator {{
  height:40px;display:flex;align-items:center;justify-content:center;
}}
.hf-ios-{uid} .plm-morph {{
  width:28px;height:28px;background:{p};border-radius:8px;
  display:flex;align-items:center;justify-content:center;
  animation:hf-ios-{uid}-morph-pulse 1.2s ease-in-out infinite;
}}
.hf-ios-{uid} .plm-icon {{width:16px;height:16px;background:#fff;border-radius:3px;}}
.hf-ios-{uid} .plm-rows {{
  padding:0 10px;display:flex;flex-direction:column;gap:6px;width:100%;
}}
.hf-ios-{uid} .plm-row {{height:22px;background:#fff;border-radius:6px;}}
.hf-ios-{uid} .plm-row-short {{height:22px;background:#fff;border-radius:6px;width:70%;}}
@keyframes hf-ios-{uid}-morph-pulse {{
  0%,100%{{border-radius:8px;transform:scale(1)}}
  50%{{border-radius:50%;transform:scale(1.1)}}
}}
</style>
<div class="plm-wrap">
  <div class="plm-indicator">
    <div class="plm-morph"><div class="plm-icon"></div></div>
  </div>
  <div class="plm-rows">
    <div class="plm-row"></div>
    <div class="plm-row-short"></div>
    <div class="plm-row"></div>
  </div>
</div>
</div>"""


def _skeleton_shimmer_ltr(tokens: dict | None) -> str:
    uid = "skeleton-shimmer-ltr"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .ssl-wrap {{
  width:210px;height:150px;background:#f2f2f7;border-radius:12px;
  overflow:hidden;padding:10px;
}}
.hf-ios-{uid} .ssl-card {{
  background:#fff;border-radius:10px;padding:10px;
  display:flex;gap:10px;align-items:center;margin-bottom:8px;
}}
.hf-ios-{uid} .ssl-avatar {{
  width:32px;height:32px;border-radius:50%;flex-shrink:0;
}}
.hf-ios-{uid} .ssl-lines {{flex:1;}}
.hf-ios-{uid} .ssl-line {{
  height:10px;border-radius:4px;margin-bottom:6px;
}}
.hf-ios-{uid} .ssl-short {{width:60%;}}
.hf-ios-{uid} .ssl-shimmer {{
  background:linear-gradient(90deg,#e5e5ea 25%,#f2f2f7 50%,#e5e5ea 75%);
  background-size:400px 100%;
  animation:hf-ios-{uid}-shimmer 1.5s infinite linear;
}}
@keyframes hf-ios-{uid}-shimmer {{
  0%{{background-position:-200px 0}} 100%{{background-position:200px 0}}
}}
</style>
<div class="ssl-wrap">
  <div class="ssl-card">
    <div class="ssl-avatar ssl-shimmer"></div>
    <div class="ssl-lines">
      <div class="ssl-line ssl-shimmer"></div>
      <div class="ssl-line ssl-short ssl-shimmer"></div>
    </div>
  </div>
  <div class="ssl-card">
    <div class="ssl-avatar ssl-shimmer"></div>
    <div class="ssl-lines">
      <div class="ssl-line ssl-shimmer"></div>
      <div class="ssl-line ssl-short ssl-shimmer"></div>
    </div>
  </div>
</div>
</div>"""


def _skeleton_pulse(tokens: dict | None) -> str:
    uid = "skeleton-pulse"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .sp-wrap {{
  width:210px;height:150px;background:#f2f2f7;border-radius:12px;
  overflow:hidden;padding:10px;
}}
.hf-ios-{uid} .sp-card {{
  background:#fff;border-radius:10px;padding:10px;
  display:flex;gap:10px;align-items:center;margin-bottom:8px;
}}
.hf-ios-{uid} .sp-avatar {{
  width:32px;height:32px;border-radius:50%;background:#e5e5ea;flex-shrink:0;
}}
.hf-ios-{uid} .sp-lines {{flex:1;}}
.hf-ios-{uid} .sp-line {{
  height:10px;border-radius:4px;background:#e5e5ea;margin-bottom:6px;
}}
.hf-ios-{uid} .sp-short {{width:60%;}}
.hf-ios-{uid} .sp-pulse {{
  animation:hf-ios-{uid}-pulse 1.5s ease-in-out infinite;
}}
@keyframes hf-ios-{uid}-pulse {{
  0%,100%{{opacity:1}} 50%{{opacity:0.4}}
}}
</style>
<div class="sp-wrap">
  <div class="sp-card">
    <div class="sp-avatar sp-pulse"></div>
    <div class="sp-lines">
      <div class="sp-line sp-pulse"></div>
      <div class="sp-line sp-short sp-pulse"></div>
    </div>
  </div>
  <div class="sp-card">
    <div class="sp-avatar sp-pulse" style="animation-delay:0.3s"></div>
    <div class="sp-lines">
      <div class="sp-line sp-pulse" style="animation-delay:0.3s"></div>
      <div class="sp-line sp-short sp-pulse" style="animation-delay:0.3s"></div>
    </div>
  </div>
</div>
</div>"""


def _skeleton_blur(tokens: dict | None) -> str:
    uid = "skeleton-blur"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .sb-wrap {{
  width:210px;height:150px;background:#f2f2f7;border-radius:12px;
  overflow:hidden;padding:10px;
}}
.hf-ios-{uid} .sb-card {{
  background:#fff;border-radius:10px;padding:10px;
  display:flex;gap:10px;align-items:center;margin-bottom:8px;
}}
.hf-ios-{uid} .sb-avatar {{width:32px;height:32px;border-radius:50%;flex-shrink:0;}}
.hf-ios-{uid} .sb-lines {{flex:1;}}
.hf-ios-{uid} .sb-line {{height:10px;border-radius:4px;margin-bottom:6px;}}
.hf-ios-{uid} .sb-short {{width:60%;}}
.hf-ios-{uid} .sb-blur {{
  filter:blur(3px);
  animation:hf-ios-{uid}-unblur 2s ease-in-out infinite;
}}
@keyframes hf-ios-{uid}-unblur {{
  0%,100%{{filter:blur(3px)}} 50%{{filter:blur(0px)}}
}}
</style>
<div class="sb-wrap">
  <div class="sb-card sb-blur">
    <div class="sb-avatar" style="background:#c7c7cc;"></div>
    <div class="sb-lines">
      <div class="sb-line" style="background:#c7c7cc;"></div>
      <div class="sb-line sb-short" style="background:#c7c7cc;"></div>
    </div>
  </div>
  <div class="sb-card">
    <div class="sb-avatar" style="background:#e5e5ea;"></div>
    <div class="sb-lines">
      <div class="sb-line" style="background:#e5e5ea;"></div>
      <div class="sb-line sb-short" style="background:#e5e5ea;"></div>
    </div>
  </div>
</div>
</div>"""


def _gradient_linear(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "gradient-linear"
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;flex-direction:column;gap:8px;padding:12px;background:#f2f2f7;border-radius:12px;">
  <button style="padding:12px;border:none;border-radius:10px;font-size:12px;font-weight:600;color:#fff;background:linear-gradient(160deg,{p} 0%,#5a4de6 100%);cursor:default;">Continue</button>
  <button style="padding:12px;border:none;border-radius:10px;font-size:12px;font-weight:600;color:#fff;background:linear-gradient(160deg,#34c759 0%,#248a3d 100%);cursor:default;">Confirm</button>
  <div style="font-size:9px;color:#8e8e93;text-align:center;">Top lighter &#8594; bottom darker</div>
</div>
</div>"""


def _gradient_mesh(tokens: dict | None) -> str:
    uid = "gradient-mesh"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .gm-wrap {{border-radius:12px;overflow:hidden;position:relative;height:140px;}}
.hf-ios-{uid} .gm-bg {{
  position:absolute;inset:0;
  background:radial-gradient(ellipse at 20% 30%,#a78bfa 0%,transparent 50%),
             radial-gradient(ellipse at 80% 20%,#38bdf8 0%,transparent 50%),
             radial-gradient(ellipse at 50% 80%,#f472b6 0%,transparent 50%),
             radial-gradient(ellipse at 10% 90%,#34d399 0%,transparent 50%),
             #1e1b4b;
  animation:hf-ios-{uid}-mesh-anim 4s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .gm-label {{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:13px;font-weight:700;
  text-shadow:0 1px 4px rgba(0,0,0,0.4);
}}
@keyframes hf-ios-{uid}-mesh-anim {{
  0%{{filter:hue-rotate(0deg) saturate(1)}} 100%{{filter:hue-rotate(30deg) saturate(1.2)}}
}}
</style>
<div class="gm-wrap">
  <div class="gm-bg"></div>
  <div class="gm-label">Aurora Gradient</div>
</div>
</div>"""


def _gradient_duotone(tokens: dict | None) -> str:
    uid = "gradient-duotone"
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;gap:6px;padding:8px;background:#f2f2f7;border-radius:12px;">
  <div style="flex:1;height:110px;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:10px;font-weight:600;">Card</span></div>
  <div style="flex:1;height:110px;border-radius:10px;background:linear-gradient(135deg,#f093fb,#f5576c);display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:10px;font-weight:600;">Card</span></div>
  <div style="flex:1;height:110px;border-radius:10px;background:linear-gradient(135deg,#4facfe,#00f2fe);display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:10px;font-weight:600;">Card</span></div>
</div>
</div>"""


def _gradient_none(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "gradient-none"
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;flex-direction:column;gap:8px;padding:12px;background:#f2f2f7;border-radius:12px;">
  <button style="padding:12px;border:none;border-radius:10px;font-size:12px;font-weight:600;color:#fff;background:{p};cursor:default;">Continue</button>
  <button style="padding:12px;border:none;border-radius:10px;font-size:12px;font-weight:600;color:#fff;background:#34c759;cursor:default;">Confirm</button>
  <div style="font-size:9px;color:#8e8e93;text-align:center;">Flat &#8212; maximum precision</div>
</div>
</div>"""


def _dark_true_black(tokens: dict | None) -> str:
    uid = "dark-true-black"
    return f"""<div class="hf-ios-{uid}">
<div style="background:#000;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;">
  <div style="background:#111;border-radius:8px;padding:8px;">
    <div style="height:10px;background:#222;border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:8px;background:#1a1a1a;border-radius:4px;width:70%;"></div>
  </div>
  <div style="background:#111;border-radius:8px;padding:8px;">
    <div style="height:10px;background:#222;border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:8px;background:#1a1a1a;border-radius:4px;width:55%;"></div>
  </div>
  <div style="font-size:9px;color:#555;text-align:center;">#000 base &#183; #111 cards</div>
</div>
</div>"""


def _dark_elevated_layers(tokens: dict | None) -> str:
    uid = "dark-elevated-layers"
    return f"""<div class="hf-ios-{uid}">
<div style="background:#111;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;">
  <div style="background:#1c1c1e;border-radius:8px;padding:8px;">
    <div style="height:10px;background:#2c2c2e;border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:8px;background:#2c2c2e;border-radius:4px;width:70%;"></div>
  </div>
  <div style="background:#1c1c1e;border-radius:8px;padding:8px;">
    <div style="height:10px;background:#2c2c2e;border-radius:4px;margin-bottom:4px;">
      <div style="height:100%;background:#3a3a3c;border-radius:4px;width:60%;"></div>
    </div>
    <div style="height:8px;background:#2c2c2e;border-radius:4px;width:55%;"></div>
  </div>
  <div style="font-size:9px;color:#555;text-align:center;">3-level system: base &#8594; card &#8594; overlay</div>
</div>
</div>"""


def _dark_deep_color(tokens: dict | None) -> str:
    uid = "dark-deep-color"
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;gap:6px;padding:8px;">
  <div style="flex:1;border-radius:10px;background:#0a0a1a;padding:8px;">
    <div style="height:8px;background:#1a1a3a;border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:6px;background:#1a1a3a;border-radius:4px;width:70%;"></div>
    <div style="font-size:8px;color:#4a4a6a;margin-top:4px;">Navy</div>
  </div>
  <div style="flex:1;border-radius:10px;background:#0f0a1a;padding:8px;">
    <div style="height:8px;background:#2a1a3a;border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:6px;background:#2a1a3a;border-radius:4px;width:70%;"></div>
    <div style="font-size:8px;color:#5a3a7a;margin-top:4px;">Purple</div>
  </div>
  <div style="flex:1;border-radius:10px;background:#0a1410;padding:8px;">
    <div style="height:8px;background:#1a2a1a;border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:6px;background:#1a2a1a;border-radius:4px;width:70%;"></div>
    <div style="font-size:8px;color:#2a4a2a;margin-top:4px;">Forest</div>
  </div>
</div>
</div>"""


def _dark_glass_layers(tokens: dict | None) -> str:
    uid = "dark-glass-layers"
    return f"""<div class="hf-ios-{uid}">
<div style="background:linear-gradient(135deg,#1a1a3a,#0a0a1a);border-radius:12px;padding:10px;position:relative;overflow:hidden;">
  <div style="position:absolute;top:-20px;left:-20px;width:80px;height:80px;background:rgba(124,107,248,0.3);border-radius:50%;filter:blur(20px);"></div>
  <div style="position:absolute;bottom:-10px;right:-10px;width:60px;height:60px;background:rgba(56,189,248,0.2);border-radius:50%;filter:blur(15px);"></div>
  <div style="background:rgba(255,255,255,0.08);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px;margin-bottom:6px;">
    <div style="height:8px;background:rgba(255,255,255,0.12);border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:4px;width:65%;"></div>
  </div>
  <div style="background:rgba(255,255,255,0.05);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px;">
    <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;margin-bottom:4px;"></div>
    <div style="height:6px;background:rgba(255,255,255,0.05);border-radius:4px;width:50%;"></div>
  </div>
</div>
</div>"""


def _accent_cta_only(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "accent-cta-only"
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;flex-direction:column;gap:6px;padding:10px;background:#f9f9f9;border-radius:12px;">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div style="width:80px;height:8px;background:#e5e5ea;border-radius:4px;"></div>
    <div style="width:24px;height:14px;background:#e5e5ea;border-radius:3px;"></div>
  </div>
  <div style="width:100%;height:7px;background:#e5e5ea;border-radius:4px;"></div>
  <div style="width:70%;height:7px;background:#e5e5ea;border-radius:4px;"></div>
  <div style="height:1px;background:#e5e5ea;margin:4px 0;"></div>
  <button data-focus-region="cta_button" style="padding:10px;border:none;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:{p};width:100%;cursor:default;">Confirm &#8212; Only accent</button>
</div>
</div>"""


def _accent_semantic(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "accent-semantic"
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;flex-direction:column;gap:5px;padding:10px;background:#f9f9f9;border-radius:12px;">
  <div style="display:flex;gap:6px;align-items:center;">
    <div data-focus-region="accent_indicators" style="width:8px;height:8px;border-radius:50%;background:{p};flex-shrink:0;"></div>
    <div style="width:80px;height:7px;background:#e5e5ea;border-radius:4px;"></div>
    <div data-focus-region="accent_indicators" style="margin-left:auto;width:30px;height:7px;background:{p};opacity:0.3;border-radius:4px;"></div>
  </div>
  <div data-focus-region="accent_indicators" style="background:#f0edff;border-radius:8px;padding:6px 8px;">
    <div style="height:7px;background:#c4b8ff;border-radius:4px;width:60%;margin-bottom:3px;"></div>
    <div style="height:5px;background:#e0d9ff;border-radius:4px;"></div>
  </div>
  <div style="display:flex;gap:6px;">
    <div style="flex:1;height:28px;border-radius:8px;background:#e5e5ea;"></div>
    <div data-focus-region="cta_button" style="flex:1;height:28px;border-radius:8px;background:{p};display:flex;align-items:center;justify-content:center;">
      <span style="color:#fff;font-size:9px;font-weight:600;">Save</span>
    </div>
  </div>
</div>
</div>"""


def _accent_expressive(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "accent-expressive"
    return f"""<div class="hf-ios-{uid}">
<div style="border-radius:12px;overflow:hidden;">
  <div data-focus-region="accent_indicators" style="background:linear-gradient(160deg,{p},#5a4de6);padding:12px;">
    <div style="height:12px;background:rgba(255,255,255,0.3);border-radius:4px;width:60%;margin-bottom:6px;"></div>
    <div style="height:9px;background:rgba(255,255,255,0.2);border-radius:4px;width:80%;"></div>
  </div>
  <div style="background:#f9f9f9;padding:8px;display:flex;flex-direction:column;gap:5px;">
    <div style="display:flex;gap:6px;align-items:center;">
      <div data-focus-region="accent_indicators" style="width:16px;height:16px;border-radius:4px;background:{p};flex-shrink:0;"></div>
      <div style="flex:1;height:7px;background:#e5e5ea;border-radius:4px;"></div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <div data-focus-region="accent_indicators" style="width:16px;height:16px;border-radius:4px;background:#b8aeff;flex-shrink:0;"></div>
      <div style="flex:1;height:7px;background:#e5e5ea;border-radius:4px;"></div>
    </div>
  </div>
</div>
</div>"""


def _icon_instant_swap(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "icon-instant-swap"
    dots = "".join(
        f'<div style="width:22px;height:22px;border-radius:50%;background:{p if i == 0 else "#c7c7cc"};opacity:{1 if i == 0 else 0.5};"></div>'
        for i in range(4)
    )
    return f"""<div class="hf-ios-{uid}">
<div style="display:flex;justify-content:center;gap:24px;padding:14px;background:#f9f9f9;border-radius:12px;align-items:center;">
  {dots}
</div>
<div style="font-size:9px;color:#8e8e93;text-align:center;margin-top:4px;">Instant fill swap &#8212; no animation</div>
</div>"""


def _icon_spring_bounce(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "icon-spring-bounce"
    dots = "".join(
        f'<div style="width:22px;height:22px;border-radius:50%;background:{p if i == 0 else "#c7c7cc"};animation:{f"hf-ios-{uid}-bounce 2s cubic-bezier(0.34,1.56,0.64,1) infinite" if i == 0 else "none"};"></div>'
        for i in range(4)
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-bounce {{
  0%,100%{{transform:scale(1)}} 15%{{transform:scale(1.3)}}
  35%{{transform:scale(0.9)}} 50%{{transform:scale(1.05)}} 65%,100%{{transform:scale(1)}}
}}
</style>
<div style="display:flex;justify-content:center;gap:24px;padding:14px;background:#f9f9f9;border-radius:12px;align-items:center;">
  {dots}
</div>
<div style="font-size:9px;color:#8e8e93;text-align:center;margin-top:4px;">Spring 1.2x bounce on tap</div>
</div>"""


def _icon_morph_fill(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "icon-morph-fill"
    dots = "".join(
        f'<div style="width:22px;height:22px;border-radius:50%;background:{("transparent" if i == 0 else "#c7c7cc")};border:{(f"2.5px solid {p}" if i == 0 else "none")};animation:{f"hf-ios-{uid}-morph 2.5s ease-in-out infinite" if i == 0 else "none"};"></div>'
        for i in range(4)
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-morph {{
  0%,20%{{background:transparent;border-color:{p}}}
  60%,80%{{background:{p};border-color:{p}}}
  100%{{background:transparent;border-color:{p}}}
}}
</style>
<div style="display:flex;justify-content:center;gap:24px;padding:14px;background:#f9f9f9;border-radius:12px;align-items:center;">
  {dots}
</div>
<div style="font-size:9px;color:#8e8e93;text-align:center;margin-top:4px;">Outline &#8594; fill morph 200ms</div>
</div>"""


def _icon_lottie_rive(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "icon-lottie-rive"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-rive-pulse {{
  0%{{transform:scale(1) rotate(0deg)}} 100%{{transform:scale(1.15) rotate(5deg)}}
}}
</style>
<div style="display:flex;justify-content:center;gap:18px;padding:14px;background:#f9f9f9;border-radius:12px;align-items:center;">
  <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
    <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,{p},#a78bfa);animation:hf-ios-{uid}-rive-pulse 1.5s ease-in-out infinite alternate;"></div>
    <span style="font-size:8px;color:{p};">Home</span>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
    <div style="width:28px;height:28px;border-radius:8px;background:#e5e5ea;"></div>
    <span style="font-size:8px;color:#8e8e93;">Search</span>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
    <div style="width:28px;height:28px;border-radius:8px;background:#e5e5ea;"></div>
    <span style="font-size:8px;color:#8e8e93;">Library</span>
  </div>
</div>
<div style="font-size:9px;color:#8e8e93;text-align:center;margin-top:4px;">Custom animated icon (Rive/Lottie)</div>
</div>"""


def _haptic_minimal(tokens: dict | None) -> str:
    uid = "haptic-minimal"
    return f"""<div class="hf-ios-{uid}">
<div style="padding:12px;background:#fff;border-radius:12px;display:flex;flex-direction:column;gap:8px;">
  <div style="display:flex;gap:8px;align-items:center;">
    <div style="width:8px;height:8px;border-radius:50%;background:#e5e5ea;"></div>
    <span style="font-size:10px;color:#8e8e93;">Button tap</span>
    <span style="font-size:9px;color:#c7c7cc;margin-left:auto;">silent</span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <div style="width:8px;height:8px;border-radius:50%;background:#e5e5ea;"></div>
    <span style="font-size:10px;color:#8e8e93;">Toggle switch</span>
    <span style="font-size:9px;color:#c7c7cc;margin-left:auto;">silent</span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <div style="width:8px;height:8px;border-radius:50%;background:#34c759;"></div>
    <span style="font-size:10px;color:#1c1c1e;font-weight:500;">Task complete</span>
    <span style="font-size:9px;color:#34c759;margin-left:auto;">&#183;&#183; success</span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <div style="width:8px;height:8px;border-radius:50%;background:#ff3b30;"></div>
    <span style="font-size:10px;color:#1c1c1e;font-weight:500;">Delete confirm</span>
    <span style="font-size:9px;color:#ff3b30;margin-left:auto;">&#183;&#183; warning</span>
  </div>
</div>
</div>"""


def _haptic_standard_vocab(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "haptic-standard-vocab"
    return f"""<div class="hf-ios-{uid}">
<div style="padding:10px;background:#fff;border-radius:12px;display:flex;flex-direction:column;gap:6px;">
  <div style="background:#f2f2f7;border-radius:8px;padding:6px 8px;display:flex;justify-content:space-between;">
    <span style="font-size:10px;color:#3c3c43;">Selection change</span>
    <span style="font-size:9px;color:{p};font-weight:600;">&#183; light tick</span>
  </div>
  <div style="background:#f2f2f7;border-radius:8px;padding:6px 8px;display:flex;justify-content:space-between;">
    <span style="font-size:10px;color:#3c3c43;">Tab switch</span>
    <span style="font-size:9px;color:{p};font-weight:600;">&#183; light tick</span>
  </div>
  <div style="background:#f2f2f7;border-radius:8px;padding:6px 8px;display:flex;justify-content:space-between;">
    <span style="font-size:10px;color:#3c3c43;">Save / Confirm</span>
    <span style="font-size:9px;color:#34c759;font-weight:600;">&#183;&#183; medium</span>
  </div>
  <div style="background:#f2f2f7;border-radius:8px;padding:6px 8px;display:flex;justify-content:space-between;">
    <span style="font-size:10px;color:#3c3c43;">Error / Fail</span>
    <span style="font-size:9px;color:#ff3b30;font-weight:600;">&#183;&#183;&#183; heavy</span>
  </div>
</div>
</div>"""


def _haptic_expressive(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "haptic-expressive"
    return f"""<div class="hf-ios-{uid}">
<div style="padding:10px;background:#fff;border-radius:12px;display:flex;flex-direction:column;gap:6px;">
  <div style="background:#f0edff;border-radius:8px;padding:6px 8px;">
    <span style="font-size:10px;color:{p};font-weight:600;">Double-tap</span>
    <span style="font-size:9px;color:#a78bfa;"> &#8594; like vibration</span>
  </div>
  <div style="background:#f0edff;border-radius:8px;padding:6px 8px;">
    <span style="font-size:10px;color:{p};font-weight:600;">Swipe threshold</span>
    <span style="font-size:9px;color:#a78bfa;"> &#8594; resistance bump</span>
  </div>
  <div style="background:#f0edff;border-radius:8px;padding:6px 8px;">
    <span style="font-size:10px;color:{p};font-weight:600;">Milestone hit</span>
    <span style="font-size:9px;color:#a78bfa;"> &#8594; custom pattern</span>
  </div>
  <div style="font-size:9px;color:#8e8e93;">CHHapticEngine &#8212; custom waveforms</div>
</div>
</div>"""


def _onboard_slide_parallax(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "onboard-slide-parallax"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .osp-wrap {{
  border-radius:12px;overflow:hidden;background:#f0edff;
  height:150px;position:relative;
}}
.hf-ios-{uid} .osp-bg1 {{
  position:absolute;width:80px;height:80px;border-radius:50%;
  background:rgba(124,107,248,0.15);top:-10px;left:-20px;
  animation:hf-ios-{uid}-parallax-bg 3s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .osp-bg2 {{
  position:absolute;width:60px;height:60px;border-radius:50%;
  background:rgba(124,107,248,0.1);bottom:0;right:-10px;
  animation:hf-ios-{uid}-parallax-bg2 3s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .osp-fg {{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:8px;
  animation:hf-ios-{uid}-parallax-fg 3s ease-in-out infinite alternate;
}}
.hf-ios-{uid} .osp-icon {{
  width:44px;height:44px;border-radius:14px;background:{p};
}}
.hf-ios-{uid} .osp-label {{font-size:11px;font-weight:700;color:#1c1c1e;}}
@keyframes hf-ios-{uid}-parallax-bg {{0%{{transform:translateX(0)}}100%{{transform:translateX(-20px)}}}}
@keyframes hf-ios-{uid}-parallax-bg2 {{0%{{transform:translateX(0)}}100%{{transform:translateX(15px)}}}}
@keyframes hf-ios-{uid}-parallax-fg {{0%{{transform:translateX(0)}}100%{{transform:translateX(-40px)}}}}
</style>
<div class="osp-wrap">
  <div class="osp-bg1"></div>
  <div class="osp-bg2"></div>
  <div class="osp-fg">
    <div class="osp-icon"></div>
    <div class="osp-label">Feature name</div>
  </div>
</div>
</div>"""


def _onboard_lottie_scenes(tokens: dict | None) -> str:
    uid = "onboard-lottie-scenes"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-lottie-anim {{
  0%{{transform:scale(1) rotate(0deg)}} 100%{{transform:scale(1.1) rotate(10deg)}}
}}
</style>
<div style="border-radius:12px;background:#fff;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;">
  <div style="width:70px;height:70px;position:relative;">
    <div style="position:absolute;inset:0;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);animation:hf-ios-{uid}-lottie-anim 2s ease-in-out infinite alternate;"></div>
    <div style="position:absolute;inset:6px;border-radius:50%;background:white;display:flex;align-items:center;justify-content:center;font-size:28px;">&#10024;</div>
  </div>
  <div style="font-size:12px;font-weight:700;color:#1c1c1e;">Animated scene</div>
  <div style="font-size:9px;color:#8e8e93;text-align:center;">Lottie plays on enter, loops subtly</div>
</div>
</div>"""


def _onboard_morph_shapes(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "onboard-morph-shapes"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-morph-shape {{
  0%,100%{{border-radius:50%;transform:scale(1)}}
  25%{{border-radius:30% 70% 70% 30% / 30% 30% 70% 70%;transform:scale(1.1)}}
  50%{{border-radius:0 100% 0 100%;transform:scale(0.9)}}
  75%{{border-radius:100% 0 100% 0%;transform:scale(1.05)}}
}}
</style>
<div style="border-radius:12px;background:#f9f9f9;height:150px;display:flex;align-items:center;justify-content:center;gap:0;position:relative;overflow:hidden;">
  <div style="width:60px;height:60px;animation:hf-ios-{uid}-morph-shape 3s ease-in-out infinite;background:linear-gradient(135deg,{p},#a78bfa);"></div>
  <div style="position:absolute;bottom:10px;left:0;right:0;text-align:center;font-size:9px;color:#8e8e93;">Shape morphs into next screen</div>
</div>
</div>"""


def _onboard_stagger_entry(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "onboard-stagger-entry"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-stagger-in {{
  0%{{opacity:0;transform:translateY(16px)}}
  5%{{opacity:1;transform:translateY(0)}}
  90%,100%{{opacity:1;transform:translateY(0)}}
}}
</style>
<div style="border-radius:12px;background:#fff;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px;gap:6px;overflow:hidden;">
  <div style="width:44px;height:44px;border-radius:14px;background:{p};animation:hf-ios-{uid}-stagger-in 2.4s ease-out infinite;"></div>
  <div style="font-size:13px;font-weight:700;color:#1c1c1e;animation:hf-ios-{uid}-stagger-in 2.4s 0.1s ease-out infinite;">Heading</div>
  <div style="width:80%;height:6px;background:#e5e5ea;border-radius:3px;animation:hf-ios-{uid}-stagger-in 2.4s 0.2s ease-out infinite;"></div>
  <div style="background:{p};color:#fff;padding:6px 18px;border-radius:20px;font-size:10px;font-weight:600;animation:hf-ios-{uid}-stagger-in 2.4s 0.35s ease-out infinite;">Continue</div>
</div>
</div>"""


def _celebrate_confetti(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "celebrate-confetti"
    colors = [p, "#ff375f", "#34c759", "#ff9f0a", "#38bdf8", "#a78bfa"]
    pieces = ""
    for i in range(20):
        c = colors[i % len(colors)]
        delay = round((i * 0.15) % 2, 2)
        left = round((i / 20) * 100)
        shape = "50%" if i % 2 else "1px"
        pieces += (
            f'<div style="position:absolute;top:-10px;left:{left}%;width:6px;height:6px;'
            f'border-radius:{shape};background:{c};'
            f'animation:hf-ios-{uid}-fall 2s {delay}s ease-in infinite;"></div>'
        )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-fall {{
  0%{{transform:translateY(0) rotate(0deg);opacity:1}}
  100%{{transform:translateY(180px) rotate(720deg);opacity:0}}
}}
@keyframes hf-ios-{uid}-bounce {{
  0%{{transform:scale(1)}} 100%{{transform:scale(1.15)}}
}}
</style>
<div style="border-radius:12px;background:#fff;height:150px;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
  {pieces}
  <div style="font-size:28px;animation:hf-ios-{uid}-bounce 1s ease-in-out infinite alternate;z-index:1;">&#127942;</div>
  <div style="font-size:13px;font-weight:700;color:#1c1c1e;z-index:1;">Streak Complete!</div>
</div>
</div>"""


def _celebrate_checkmark_ripple(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "celebrate-checkmark-ripple"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-ripple-out {{
  0%{{transform:scale(1);opacity:0.6}} 100%{{transform:scale(1.8);opacity:0}}
}}
@keyframes hf-ios-{uid}-check-draw {{
  0%,100%{{transform:scale(1)}} 10%{{transform:scale(1.2)}}
  25%{{transform:scale(0.95)}} 35%{{transform:scale(1)}}
}}
</style>
<div style="border-radius:12px;background:#fff;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;position:relative;">
  <div style="position:relative;width:60px;height:60px;display:flex;align-items:center;justify-content:center;">
    <div style="position:absolute;width:60px;height:60px;border-radius:50%;border:2px solid rgba(124,107,248,0.3);animation:hf-ios-{uid}-ripple-out 2s ease-out infinite;"></div>
    <div style="position:absolute;width:44px;height:44px;border-radius:50%;border:2px solid rgba(124,107,248,0.2);animation:hf-ios-{uid}-ripple-out 2s 0.3s ease-out infinite;"></div>
    <div style="width:44px;height:44px;border-radius:50%;background:{p};display:flex;align-items:center;justify-content:center;animation:hf-ios-{uid}-check-draw 2s ease-in-out infinite;">
      <span style="color:#fff;font-size:20px;font-weight:700;">&#10003;</span>
    </div>
  </div>
  <div style="font-size:12px;font-weight:600;color:#1c1c1e;">Task Complete</div>
</div>
</div>"""


def _celebrate_full_screen(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "celebrate-full-screen"
    stars = "".join(
        f'<div style="position:absolute;font-size:{14 + i * 2}px;'
        f'animation:hf-ios-{uid}-float {3}s {i * 0.3}s ease-in-out infinite alternate;'
        f'top:{10 + i * 10}%;left:{10 + i * 11}%;">&#11088;</div>'
        for i in range(8)
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-float {{0%{{transform:translateY(0)}}100%{{transform:translateY(-10px)}}}}
@keyframes hf-ios-{uid}-trophy {{0%{{transform:scale(1)}}100%{{transform:scale(1.1)}}}}
</style>
<div style="border-radius:12px;overflow:hidden;height:150px;background:linear-gradient(160deg,{p},#a78bfa);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;position:relative;">
  {stars}
  <div style="font-size:36px;z-index:1;animation:hf-ios-{uid}-trophy 1.5s ease-in-out infinite alternate;">&#127942;</div>
  <div style="font-size:14px;font-weight:800;color:#fff;z-index:1;">100 Day Streak!</div>
  <div style="font-size:10px;color:rgba(255,255,255,0.8);z-index:1;">Full screen takeover &#8212; major milestone</div>
</div>
</div>"""


def _celebrate_score_glow(tokens: dict | None) -> str:
    uid = "celebrate-score-glow"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-glow-pulse {{0%,100%{{opacity:0}}50%{{opacity:1}}}}
@keyframes hf-ios-{uid}-score-tick {{0%{{transform:scale(1.05)}}20%{{transform:scale(1)}}100%{{transform:scale(1)}}}}
</style>
<div style="border-radius:12px;background:#fff;height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
  <div style="position:relative;text-align:center;">
    <div style="position:absolute;inset:-10px;border-radius:50%;background:rgba(124,107,248,0.1);animation:hf-ios-{uid}-glow-pulse 2s ease-in-out infinite;"></div>
    <div style="font-size:40px;font-weight:800;color:#1c1c1e;letter-spacing:-0.04em;animation:hf-ios-{uid}-score-tick 2s ease-out infinite;">1,247</div>
  </div>
  <div style="display:flex;align-items:center;gap:4px;animation:hf-ios-{uid}-score-tick 2s 0.3s ease-out infinite;">
    <span style="font-size:13px;font-weight:600;color:#34c759;">+83 pts</span>
    <span style="font-size:12px;">&#10024;</span>
  </div>
  <div style="font-size:9px;color:#8e8e93;">Number ticks up + glow pulse</div>
</div>
</div>"""


def _splash_fade_in(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "splash-fade-in"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-logo-fade {{
  0%,20%{{opacity:0;transform:scale(0.9)}}
  40%,80%{{opacity:1;transform:scale(1)}}
  100%{{opacity:0;transform:scale(1.05)}}
}}
</style>
<div style="border-radius:12px;background:{p};height:150px;display:flex;align-items:center;justify-content:center;">
  <div style="display:flex;flex-direction:column;align-items:center;gap:8px;animation:hf-ios-{uid}-logo-fade 2.5s ease-in-out infinite alternate;">
    <div style="width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,0.25);border:2px solid rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;">
      <span style="font-size:22px;font-weight:900;color:#fff;">A</span>
    </div>
    <span style="color:rgba(255,255,255,0.9);font-size:12px;font-weight:600;letter-spacing:0.08em;">APPNAME</span>
  </div>
</div>
</div>"""


def _splash_logo_build(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "splash-logo-build"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-draw-circle {{0%{{stroke-dashoffset:163}}100%{{stroke-dashoffset:0}}}}
@keyframes hf-ios-{uid}-fade-in-text {{0%{{opacity:0}}100%{{opacity:1}}}}
</style>
<div style="border-radius:12px;background:#0f0f11;height:150px;display:flex;align-items:center;justify-content:center;">
  <svg viewBox="0 0 60 60" width="60" height="60">
    <circle cx="30" cy="30" r="26" fill="none" stroke="{p}" stroke-width="3"
      stroke-dasharray="163" stroke-dashoffset="163"
      style="animation:hf-ios-{uid}-draw-circle 2s ease-out infinite alternate;" stroke-linecap="round"/>
    <text x="30" y="36" text-anchor="middle" font-size="16" font-weight="900" fill="{p}"
      style="animation:hf-ios-{uid}-fade-in-text 2s 0.8s ease-out infinite alternate;opacity:0;">A</text>
  </svg>
</div>
</div>"""


def _splash_morph_ui(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "splash-morph-ui"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-morph-to-ui {{
  0%,30%{{width:50px;height:50px;border-radius:14px}}
  70%,100%{{width:220px;height:150px;border-radius:0px}}
}}
@keyframes hf-ios-{uid}-logo-fade-morph {{
  0%,30%{{opacity:1}} 60%,100%{{opacity:0}}
}}
</style>
<div style="border-radius:12px;background:#f2f2f7;height:150px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;">
  <div style="width:50px;height:50px;border-radius:14px;background:{p};animation:hf-ios-{uid}-morph-to-ui 3s ease-in-out infinite;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;">
    <span style="color:#fff;font-size:22px;font-weight:900;animation:hf-ios-{uid}-logo-fade-morph 3s ease-in-out infinite;">A</span>
  </div>
</div>
</div>"""


def _splash_ambient_particle(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "splash-ambient-particle"
    particles = "".join(
        f'<div style="position:absolute;width:{20 + i * 8}px;height:{20 + i * 8}px;'
        f'border-radius:50%;background:rgba(124,107,248,{0.08 + i * 0.02:.2f});'
        f'animation:hf-ios-{uid}-float {2 + i * 0.5}s {i * 0.4}s ease-in-out infinite alternate;'
        f'top:{10 + i * 10}%;left:{5 + i * 12}%;filter:blur(8px);"></div>'
        for i in range(8)
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-float {{
  0%{{transform:translateY(0) scale(1)}} 100%{{transform:translateY(-20px) scale(1.1)}}
}}
</style>
<div style="border-radius:12px;background:#0f0f11;height:150px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">
  {particles}
  <div style="z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
    <div style="width:44px;height:44px;border-radius:14px;background:{p};display:flex;align-items:center;justify-content:center;">
      <span style="font-size:22px;font-weight:900;color:#fff;">A</span>
    </div>
    <span style="color:rgba(255,255,255,0.6);font-size:10px;letter-spacing:0.1em;">APPNAME</span>
  </div>
</div>
</div>"""


def _scroll_system(tokens: dict | None) -> str:
    uid = "scroll-system"
    rows = "".join(
        f'<div style="background:#fff;border-radius:8px;height:28px;display:flex;align-items:center;padding:0 8px;gap:6px;">'
        f'<div style="width:16px;height:16px;border-radius:4px;background:#e5e5ea;"></div>'
        f'<div style="height:8px;background:#e5e5ea;border-radius:3px;flex:1;width:{50 + i * 8}%;"></div></div>'
        for i in range(6)
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-scroll-demo {{
  0%{{transform:translateY(0)}} 100%{{transform:translateY(-40px)}}
}}
</style>
<div style="border-radius:12px;overflow:hidden;background:#f2f2f7;height:150px;position:relative;">
  <div style="display:flex;flex-direction:column;gap:6px;padding:10px;animation:hf-ios-{uid}-scroll-demo 3s ease-in-out infinite alternate;">
    {rows}
  </div>
</div>
</div>"""


def _scroll_sticky_headers(tokens: dict | None) -> str:
    uid = "scroll-sticky-headers"
    rows = "".join(
        '<div style="background:#fff;border-radius:8px;height:24px;display:flex;align-items:center;padding:0 8px;gap:6px;">'
        '<div style="width:14px;height:14px;border-radius:50%;background:#e5e5ea;"></div>'
        '<div style="height:7px;background:#e5e5ea;border-radius:3px;flex:1;"></div></div>'
        for _ in range(6)
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-scroll-items {{
  0%{{transform:translateY(0)}} 100%{{transform:translateY(-50px)}}
}}
</style>
<div style="border-radius:12px;overflow:hidden;background:#f2f2f7;height:150px;position:relative;">
  <div style="position:absolute;top:0;left:0;right:0;background:#f2f2f7;padding:6px 10px;font-size:10px;font-weight:700;color:#8e8e93;letter-spacing:0.04em;z-index:2;border-bottom:0.5px solid #e5e5ea;">PINNED SECTION A</div>
  <div style="position:absolute;top:0;left:0;right:0;bottom:0;padding-top:26px;overflow:hidden;">
    <div style="display:flex;flex-direction:column;gap:5px;padding:6px 10px;animation:hf-ios-{uid}-scroll-items 3s ease-in-out infinite alternate;">
      {rows}
    </div>
  </div>
</div>
</div>"""


def _scroll_parallax_bg(tokens: dict | None) -> str:
    p = _purple(tokens)
    uid = "scroll-parallax-bg"
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-parallax-slow {{0%{{transform:translateY(0)}}100%{{transform:translateY(-20px)}}}}
@keyframes hf-ios-{uid}-parallax-fast {{0%{{transform:translateY(0)}}100%{{transform:translateY(-50px)}}}}
@keyframes hf-ios-{uid}-content-slide {{0%{{transform:translateY(0)}}100%{{transform:translateY(-30px)}}}}
</style>
<div style="border-radius:12px;overflow:hidden;background:#f2f2f7;height:150px;position:relative;">
  <div style="position:absolute;inset:0;background:linear-gradient(160deg,{p},#a78bfa);animation:hf-ios-{uid}-parallax-slow 3s ease-in-out infinite alternate;transform-origin:top center;"></div>
  <div style="position:absolute;top:0;left:0;right:0;padding:10px;animation:hf-ios-{uid}-parallax-fast 3s ease-in-out infinite alternate;transform-origin:top center;">
    <div style="height:40px;border-radius:8px;background:rgba(255,255,255,0.3);margin-bottom:4px;"></div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;background:#fff;border-radius:12px 12px 0 0;padding:10px;animation:hf-ios-{uid}-content-slide 3s ease-in-out infinite alternate;">
    <div style="height:8px;background:#e5e5ea;border-radius:3px;width:60%;margin-bottom:5px;"></div>
    <div style="height:6px;background:#e5e5ea;border-radius:3px;"></div>
  </div>
</div>
</div>"""


def _scroll_snap_cards(tokens: dict | None) -> str:
    uid = "scroll-snap-cards"
    card_colors = ["#7c6bf8", "#34c759", "#ff375f"]
    cards = "".join(
        f'<div style="min-width:190px;height:130px;border-radius:12px;background:{c};'
        f'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;">'
        f'<div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.3);"></div>'
        f'<div style="width:80px;height:8px;background:rgba(255,255,255,0.4);border-radius:3px;"></div>'
        f'</div>'
        for c in card_colors
    )
    return f"""<div class="hf-ios-{uid}">
<style>
@keyframes hf-ios-{uid}-snap-scroll {{
  0%,20%{{transform:translateX(0)}}
  50%,70%{{transform:translateX(-140px)}}
  90%,100%{{transform:translateX(-280px)}}
}}
</style>
<div style="border-radius:12px;overflow:hidden;background:#f2f2f7;height:150px;position:relative;">
  <div style="display:flex;gap:8px;padding:10px;animation:hf-ios-{uid}-snap-scroll 3s ease-in-out infinite alternate;">
    {cards}
  </div>
</div>
</div>"""


# ── Behavior-annotation detent fragments ──────────────────────────────────────
#
# These are NOT high-fidelity color/elevation/motion fragments — they are
# BEHAVIOR ANNOTATIONS for the sheet-size category's detent options.
# They are NOT in IOS_HIGH_FI_IDS and NOT in _RENDERERS (which would break the
# assert below).  They are imported directly by behavior_preview.py.
#
# Design contract per task spec:
#   Phone frame + content area (opacity 0.45 behind sheet) + sheet rectangle
#   from the bottom + drag handle (3 short lines) + dashed position marker(s)
#   + right-aligned numeric label (font-size:10px) + caption below frame.
#   Snap fragment additionally: @keyframes cycling height 30%→85%→30% over ~2.4s
#   (screenshot-safe: dashed lines + dots + caption carry meaning at frame 0).

def _hf_ios_detent_fixed_40(tokens: dict | None) -> str:
    uid = "detent-medium-only"
    border = "#c7c7cc"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .det-frame {{
  width:160px;height:280px;background:#1c1c1e;border-radius:24px;
  position:relative;overflow:hidden;flex-shrink:0;
  box-shadow:0 4px 20px rgba(0,0,0,0.35);
}}
.hf-ios-{uid} .det-content {{
  position:absolute;inset:0;
  background:linear-gradient(160deg,#f2f2f7 0%,#e5e5ea 100%);
  opacity:0.45;
}}
.hf-ios-{uid} .det-sheet {{
  position:absolute;left:0;right:0;bottom:0;
  height:40%;
  background:#fff;border-radius:16px 16px 0 0;
}}
.hf-ios-{uid} .det-handle {{
  display:flex;flex-direction:column;gap:3px;
  align-items:center;padding-top:8px;
}}
.hf-ios-{uid} .det-handle-bar {{
  width:28px;height:3px;background:{border};border-radius:2px;
}}
.hf-ios-{uid} .det-marker {{
  position:absolute;left:0;right:0;
  border-top:1px dashed {border};
  display:flex;justify-content:flex-end;align-items:center;padding-right:6px;
}}
.hf-ios-{uid} .det-label {{
  font-size:10px;color:#8e8e93;background:#fff;
  padding:1px 3px;line-height:1;
}}
.hf-ios-{uid} .det-caption {{
  font-size:10px;color:#3c3c43;text-align:center;margin-top:8px;
  max-width:160px;line-height:1.4;
}}
.hf-ios-{uid} .det-wrap {{
  display:flex;flex-direction:column;align-items:center;
}}
</style>
<div class="det-wrap">
  <div class="det-frame">
    <div class="det-content"></div>
    <div class="det-sheet">
      <div class="det-handle">
        <div class="det-handle-bar"></div>
        <div class="det-handle-bar"></div>
        <div class="det-handle-bar"></div>
      </div>
    </div>
    <!-- marker at 40% from bottom = 60% from top -->
    <div class="det-marker" style="bottom:40%;">
      <span class="det-label">40%</span>
    </div>
  </div>
  <div class="det-caption">Sheet locked at 40% — no drag</div>
</div>
</div>"""


def _hf_ios_detent_snap_30_85(tokens: dict | None) -> str:
    uid = "detent-snap-two"
    accent = "#007AFF"
    try:
        accent = tokens["color"]["accent"]  # type: ignore[index]
    except (TypeError, KeyError):
        pass
    border = "#c7c7cc"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .dsnap-frame {{
  width:160px;height:280px;background:#1c1c1e;border-radius:24px;
  position:relative;overflow:hidden;flex-shrink:0;
  box-shadow:0 4px 20px rgba(0,0,0,0.35);
}}
.hf-ios-{uid} .dsnap-content {{
  position:absolute;inset:0;
  background:linear-gradient(160deg,#f2f2f7 0%,#e5e5ea 100%);
  opacity:0.45;
}}
.hf-ios-{uid} .dsnap-sheet {{
  position:absolute;left:0;right:0;bottom:0;
  background:#fff;border-radius:16px 16px 0 0;
  animation:hf-ios-{uid}-detent-cycle 2.4s ease-in-out infinite;
}}
.hf-ios-{uid} .dsnap-handle {{
  display:flex;flex-direction:column;gap:3px;
  align-items:center;padding-top:8px;
}}
.hf-ios-{uid} .dsnap-handle-bar {{
  width:28px;height:3px;background:{border};border-radius:2px;
}}
.hf-ios-{uid} .dsnap-marker {{
  position:absolute;left:0;right:0;
  border-top:1px dashed {border};
  display:flex;justify-content:flex-end;align-items:center;padding-right:6px;
}}
.hf-ios-{uid} .dsnap-dot {{
  position:absolute;left:50%;transform:translateX(-50%) translateY(-50%);
  width:6px;height:6px;border-radius:50%;background:{accent};
}}
.hf-ios-{uid} .dsnap-label {{
  font-size:10px;color:#8e8e93;background:#fff;
  padding:1px 3px;line-height:1;
}}
.hf-ios-{uid} .dsnap-caption {{
  font-size:10px;color:#3c3c43;text-align:center;margin-top:8px;
  max-width:160px;line-height:1.4;
}}
.hf-ios-{uid} .dsnap-wrap {{
  display:flex;flex-direction:column;align-items:center;
}}
@keyframes hf-ios-{uid}-detent-cycle {{
  0%,5%  {{ height:30%; }}
  35%,65%{{ height:85%; }}
  95%,100%{{ height:30%; }}
}}
</style>
<div class="dsnap-wrap">
  <div class="dsnap-frame">
    <div class="dsnap-content"></div>
    <div class="dsnap-sheet">
      <div class="dsnap-handle">
        <div class="dsnap-handle-bar"></div>
        <div class="dsnap-handle-bar"></div>
        <div class="dsnap-handle-bar"></div>
      </div>
    </div>
    <!-- snap stop at 30% from bottom -->
    <div class="dsnap-marker" style="bottom:30%;">
      <div class="dsnap-dot"></div>
      <span class="dsnap-label">30%</span>
    </div>
    <!-- snap stop at 85% from bottom -->
    <div class="dsnap-marker" style="bottom:85%;">
      <div class="dsnap-dot"></div>
      <span class="dsnap-label">85%</span>
    </div>
  </div>
  <div class="dsnap-caption">Snaps to 30% or 85% — two resting positions</div>
</div>
</div>"""


def _hf_ios_detent_free(tokens: dict | None) -> str:
    uid = "detent-continuous"
    border = "#c7c7cc"
    return f"""<div class="hf-ios-{uid}">
<style>
.hf-ios-{uid} .dfree-frame {{
  width:160px;height:280px;background:#1c1c1e;border-radius:24px;
  position:relative;overflow:hidden;flex-shrink:0;
  box-shadow:0 4px 20px rgba(0,0,0,0.35);
}}
.hf-ios-{uid} .dfree-content {{
  position:absolute;inset:0;
  background:linear-gradient(160deg,#f2f2f7 0%,#e5e5ea 100%);
  opacity:0.45;
}}
.hf-ios-{uid} .dfree-sheet {{
  position:absolute;left:0;right:0;bottom:0;
  height:55%;
  background:#fff;border-radius:16px 16px 0 0;
}}
.hf-ios-{uid} .dfree-handle {{
  display:flex;flex-direction:column;gap:3px;
  align-items:center;padding-top:8px;
}}
.hf-ios-{uid} .dfree-handle-bar {{
  width:28px;height:3px;background:{border};border-radius:2px;
}}
.hf-ios-{uid} .dfree-caption {{
  font-size:10px;color:#3c3c43;text-align:center;margin-top:8px;
  max-width:160px;line-height:1.4;
}}
.hf-ios-{uid} .dfree-wrap {{
  display:flex;flex-direction:column;align-items:center;
}}
</style>
<div class="dfree-wrap">
  <div class="dfree-frame">
    <div class="dfree-content"></div>
    <div class="dfree-sheet">
      <div class="dfree-handle">
        <div class="dfree-handle-bar"></div>
        <div class="dfree-handle-bar"></div>
        <div class="dfree-handle-bar"></div>
      </div>
    </div>
  </div>
  <div class="dfree-caption">Sheet rests wherever the user releases it</div>
</div>
</div>"""


# ── Dispatch table ────────────────────────────────────────────────────────────

_RENDERERS: dict[str, object] = {
    "press-scale-down": _press_scale_down,
    "press-opacity-dim": _press_opacity_dim,
    "press-highlight-bg": _press_highlight_bg,
    "press-ripple": _press_ripple,
    "btn-flat": _btn_flat,
    "btn-soft-shadow": _btn_soft_shadow,
    "btn-inner-highlight": _btn_inner_highlight,
    "btn-glass": _btn_glass,
    "transition-push-slide": _transition_push_slide,
    "transition-hero-expand": _transition_hero_expand,
    "transition-fade": _transition_fade,
    "transition-sheet-up": _transition_sheet_up,
    "ptr-native-spinner": _ptr_native_spinner,
    "ptr-progress-arc": _ptr_progress_arc,
    "ptr-logo-morph": _ptr_logo_morph,
    "skeleton-shimmer-ltr": _skeleton_shimmer_ltr,
    "skeleton-pulse": _skeleton_pulse,
    "skeleton-blur": _skeleton_blur,
    "gradient-linear": _gradient_linear,
    "gradient-mesh": _gradient_mesh,
    "gradient-duotone": _gradient_duotone,
    "gradient-none": _gradient_none,
    "dark-true-black": _dark_true_black,
    "dark-elevated-layers": _dark_elevated_layers,
    "dark-deep-color": _dark_deep_color,
    "dark-glass-layers": _dark_glass_layers,
    "accent-cta-only": _accent_cta_only,
    "accent-semantic": _accent_semantic,
    "accent-expressive": _accent_expressive,
    "icon-instant-swap": _icon_instant_swap,
    "icon-spring-bounce": _icon_spring_bounce,
    "icon-morph-fill": _icon_morph_fill,
    "icon-lottie-rive": _icon_lottie_rive,
    "haptic-minimal": _haptic_minimal,
    "haptic-standard-vocab": _haptic_standard_vocab,
    "haptic-expressive": _haptic_expressive,
    "onboard-slide-parallax": _onboard_slide_parallax,
    "onboard-lottie-scenes": _onboard_lottie_scenes,
    "onboard-morph-shapes": _onboard_morph_shapes,
    "onboard-stagger-entry": _onboard_stagger_entry,
    "celebrate-confetti": _celebrate_confetti,
    "celebrate-checkmark-ripple": _celebrate_checkmark_ripple,
    "celebrate-full-screen": _celebrate_full_screen,
    "celebrate-score-glow": _celebrate_score_glow,
    "splash-fade-in": _splash_fade_in,
    "splash-logo-build": _splash_logo_build,
    "splash-morph-ui": _splash_morph_ui,
    "splash-ambient-particle": _splash_ambient_particle,
    "scroll-system": _scroll_system,
    "scroll-sticky-headers": _scroll_sticky_headers,
    "scroll-parallax-bg": _scroll_parallax_bg,
    "scroll-snap-cards": _scroll_snap_cards,
}

assert set(_RENDERERS.keys()) == IOS_HIGH_FI_IDS, (
    "Renderer table keys do not match IOS_HIGH_FI_IDS — update one to match the other."
)


# ── Public API ────────────────────────────────────────────────────────────────

def has_ios_high_fi(option_id: str) -> bool:
    """Return True if a high-fi renderer exists for the given option-id."""
    return option_id in IOS_HIGH_FI_IDS


def render_ios_high_fi(option_id: str, tokens: dict | None = None) -> str | None:
    """Return a self-contained, CSS-scoped HTML fragment for the given high-fi
    iOS option-id, or None if no high-fi art exists for it (caller falls back
    to low-fi).

    Args:
        option_id: One of the 52 high-fi option IDs in IOS_HIGH_FI_IDS.
        tokens: Optional token dict, e.g. {'color': {'accent': '#FF00AA'}}.
                When provided, the accent color overrides the prototype default.

    Returns:
        HTML string or None.
    """
    fn = _RENDERERS.get(option_id)
    if fn is None:
        return None
    return fn(tokens)  # type: ignore[operator]
