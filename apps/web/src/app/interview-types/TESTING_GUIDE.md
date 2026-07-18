# 3D Carousel Testing Guide

## Quick Testing Checklist

### Desktop Testing (Chrome/Firefox/Safari)

#### Basic Hover Interactions
1. **Hover on left near card** (CS Fundamentals when System Design is active)
   - ✅ Card should smoothly move to center
   - ✅ Card should straighten (rotate to 0°)
   - ✅ Card should scale up to full size
   - ✅ CTA button should appear
   - ✅ Previous center card should move to right

2. **Hover on left far card** (Full Interview when System Design is active)
   - ✅ Card should glide to center
   - ✅ All other cards should rearrange circularly
   - ✅ Animation should be smooth (no jank)

3. **Hover on right near card** (Coding when System Design is active)
   - ✅ Card should move to center
   - ✅ Previous center card should move to left

4. **Hover on right far card** (Behavioral when System Design is active)
   - ✅ Card should move to center
   - ✅ Circular wrapping should work correctly

#### Rapid Hover Testing
5. **Quickly hover across multiple cards**
   - ✅ Animations should queue smoothly
   - ✅ No visual glitches or flickering
   - ✅ Z-index should remain correct
   - ✅ Performance should stay at 60fps
   - ✅ **NEW**: Hover during animation should be blocked (cursor shows 'wait')
   - ✅ **NEW**: Next hover only registers after animation completes (750ms cooldown)

#### Persistence Testing
6. **Hover on a card, then move mouse away**
   - ✅ Active card should remain in center
   - ✅ Should NOT reset to previous card
   - ✅ CTA button should remain visible

---

### Mobile Testing (iOS Safari, Chrome Mobile)

#### Tap Interactions
1. **Tap on a side card**
   - ✅ Card should move to center
   - ✅ CTA button should appear
   - ✅ Other cards should rearrange

2. **Tap multiple cards quickly**
   - ✅ Each tap should register
   - ✅ Animations should be smooth
   - ✅ No double-tap zoom issues

3. **Check viewport**
   - ✅ No horizontal scrolling
   - ✅ Cards should fit within screen
   - ✅ Center card should be fully readable

---

### Keyboard Navigation Testing

1. **Tab through cards**
   - ✅ Each card should be focusable
   - ✅ Focus ring should be visible (blue ring)
   - ✅ Focused card should become active

2. **Tab to CTA button**
   - ✅ Button should be reachable
   - ✅ Focus ring should appear

3. **Press Enter on CTA button**
   - ✅ Should navigate to correct route

4. **Tab to navigation dots**
   - ✅ Dots should be focusable
   - ✅ Enter/Space should change active card

---

### Visual Quality Testing

#### Z-Index Stacking
- ✅ Center card should always be on top
- ✅ Near cards should be behind center
- ✅ Far cards should be behind near cards
- ✅ No cards should incorrectly overlap during animation

#### Opacity & Brightness
- ✅ Center card: fully visible (opacity 1)
- ✅ Near cards: slightly faded (opacity 0.65)
- ✅ Far cards: more faded (opacity 0.35)
- ✅ Brightness filter should create depth effect

#### Card Rotation
- ✅ Center card: straight (0°)
- ✅ Left near: tilted left (-20°)
- ✅ Left far: more tilted left (-32°)
- ✅ Right near: tilted right (20°)
- ✅ Right far: more tilted right (32°)

#### CTA Button Visibility
- ✅ Only visible on center/active card
- ✅ Hidden on all side cards
- ✅ Smooth fade-in animation (300ms delay)
- ✅ Shimmer effect on hover

#### Dark Theme
- ✅ Background colors correct
- ✅ Text colors readable
- ✅ Blue glow on active card
- ✅ Border colors appropriate
- ✅ Navigation dots visible

---

### Animation Smoothness Testing

1. **Check animation duration**
   - ✅ Should take ~650ms
   - ✅ Should feel premium (not too fast, not too slow)

2. **Check easing**
   - ✅ Should have smooth acceleration/deceleration
   - ✅ No abrupt stops

3. **Check simultaneous properties**
   - ✅ Transform, opacity, filter should animate together
   - ✅ No property should lag behind

---

### Responsive Breakpoint Testing

#### Desktop (1024px+)
- ✅ Near cards: ~250px offset
- ✅ Far cards: ~470px offset
- ✅ Cards should look like wide 3D fan

#### Tablet (768px - 1023px)
- ✅ Near cards: ~180px offset
- ✅ Far cards: ~330px offset
- ✅ Cards should be closer together

#### Mobile (<768px)
- ✅ Near cards: ~110px offset
- ✅ Far cards: ~200px offset
- ✅ Cards should be compact
- ✅ Center card should remain readable

---

### Circular Rotation Testing

Test all possible transitions to ensure circular logic works:

1. **Full Interview → CS Fundamentals** ✅
2. **CS Fundamentals → System Design** ✅
3. **System Design → Coding** ✅
4. **Coding → Behavioral** ✅
5. **Behavioral → Full Interview** (wrap around) ✅
6. **Full Interview → Behavioral** (reverse wrap) ✅

---

### Navigation Dots Testing

1. **Click each dot**
   - ✅ Should activate corresponding card
   - ✅ Dot should expand and change color
   - ✅ Previous dot should shrink

2. **Visual feedback**
   - ✅ Active dot: 36px wide, blue gradient
   - ✅ Inactive dots: 10px wide, gray
   - ✅ Smooth transition between states

---

### Performance Testing

#### Frame Rate
- Open DevTools → Performance tab
- Record while hovering rapidly
- ✅ Should maintain 60fps
- ✅ No dropped frames

#### Memory
- ✅ No memory leaks on repeated interactions
- ✅ Component should clean up properly

#### CPU Usage
- ✅ Should use GPU acceleration
- ✅ CPU usage should be minimal

---

### Accessibility Testing

#### Screen Reader
- Use NVDA (Windows) or VoiceOver (Mac)
- ✅ Card titles should be announced
- ✅ Button labels should be clear
- ✅ Navigation dots should have labels

#### Keyboard Only
- Unplug mouse
- ✅ Should be able to navigate entire carousel
- ✅ Should be able to activate CTA button
- ✅ Focus should be visible at all times

#### Color Contrast
- Use browser DevTools → Accessibility
- ✅ Text should meet WCAG AA standards
- ✅ Button text should be readable

---

## Common Issues & Solutions

### Issue: Cards overlap incorrectly
**Solution**: Check z-index values in `getCardStyles()`

### Issue: Animation feels janky
**Solution**: Ensure `willChange` is set and GPU acceleration is active

### Issue: Hover doesn't work on mobile
**Solution**: Mobile uses tap, not hover - this is expected

### Issue: Cards overflow on small screens
**Solution**: Check responsive spacing values in `getCardStyles()`

### Issue: CTA button appears on multiple cards
**Solution**: Check `isActive` condition in render logic

### Issue: Rapid hovering causes cards to jump or skip
**Solution**: Animation delay protection is now active - hovers during animation are blocked (750ms cooldown)

---

## Browser DevTools Commands

### Check GPU Acceleration
```
Chrome: DevTools → More Tools → Rendering → Paint flashing
```

### Check Animation Performance
```
Chrome: DevTools → Performance → Record → Hover cards → Stop
Look for green bars (good) vs red bars (bad)
```

### Check Accessibility
```
Chrome: DevTools → Lighthouse → Accessibility audit
```

---

## Expected Results Summary

✅ **Smooth 3D carousel effect**
✅ **Hover activates cards on desktop**
✅ **Tap activates cards on mobile**
✅ **Circular rotation with no start/end**
✅ **Only active card shows CTA button**
✅ **Premium animation feel (650ms cubic-bezier)**
✅ **Fully accessible with keyboard**
✅ **Responsive on all screen sizes**
✅ **60fps performance**
✅ **Dark theme support**

---

**Last Updated**: 2026-04-26
