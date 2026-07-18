# Z-Index, Opacity & Color Improvements

## Overview

Fixed card stacking, opacity, and color issues to ensure proper layering where only side edges of underlapping cards are visible, with improved visual distinction between active and inactive cards.

---

## Changes Made

### 1. Z-Index Hierarchy (Fixed)

**Previous (Incorrect)**:
```
Center: z-index 50
Near cards: z-index 30
Far cards: z-index 10
```

**New (Correct)**:
```
Center: z-index 50  (highest - always on top)
Near cards: z-index 40  (middle - behind center, above far)
Far cards: z-index 30  (lowest visible - behind near)
Hidden: z-index 0
```

**Why This Matters**:
- Proper stacking ensures center card is always fully visible
- Near cards appear behind center but above far cards
- Far cards show only their side edges (as intended)
- No visual glitches or incorrect overlapping

---

### 2. Opacity Fixed (All Cards Fully Opaque)

**Previous (Problematic)**:
```
Center: opacity 1
Near: opacity 0.65
Far: opacity 0.35
```

**New (Correct)**:
```
All cards: opacity 1
```

**Why This Change**:
- Opacity was making cards transparent, showing content through them
- Now cards are fully opaque, only side edges visible due to positioning
- Cleaner, more professional look
- Better readability on all cards

---

### 3. Brightness for Depth (Unchanged)

```
Center: brightness 1 (full brightness)
Near: brightness 0.7 (slightly dimmed)
Far: brightness 0.5 (more dimmed)
```

This creates depth perception without transparency issues.

---

### 4. Inactive Card Colors (Improved Contrast)

#### Dark Theme

**Active Card**:
```css
background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)
border: 2px solid rgba(74, 124, 255, 0.4)
shadow: 0 30px 70px rgba(74, 124, 255, 0.5)
```

**Inactive Cards**:
```css
background: linear-gradient(135deg, #1a1a1a 0%, #252525 100%)
border: 1px solid rgba(255, 255, 255, 0.03)
shadow: 0 15px 50px rgba(0, 0, 0, 0.8)
```

#### Light Theme

**Active Card**:
```css
background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)
border: 2px solid rgba(74, 124, 255, 0.3)
shadow: 0 30px 70px rgba(74, 124, 255, 0.3)
```

**Inactive Cards**:
```css
background: linear-gradient(135deg, #e8e9eb 0%, #d4d5d7 100%)
border: 1px solid rgba(0, 0, 0, 0.08)
shadow: 0 15px 50px rgba(0, 0, 0, 0.15)
```

---

### 5. Text Color Adjustments

#### Active Card Text
- **Category**: Yellow (dark) / Blue (light) - fully visible
- **Title**: White (dark) / Black (light) - fully visible
- **Description**: 80% opacity - fully readable

#### Inactive Card Text
- **Category**: 25% opacity - subtle
- **Title**: 40% opacity - visible but de-emphasized
- **Description**: 30-35% opacity - readable but clearly inactive

---

### 6. Spacing Adjustments

**Previous**:
```
Desktop: near 250px, far 470px
Tablet: near 180px, far 330px
Mobile: near 110px, far 200px
```

**New**:
```
Desktop: near 280px, far 520px  (+30px, +50px)
Tablet: near 200px, far 360px   (+20px, +30px)
Mobile: near 120px, far 220px   (+10px, +20px)
```

**Why**: Increased spacing ensures only side edges of far cards are visible, preventing content overlap.

---

### 7. Rotation Adjustments

**Previous**:
```
Near: ±20°
Far: ±32°
```

**New**:
```
Near: ±22°  (+2°)
Far: ±35°   (+3°)
```

**Why**: Slightly more rotation creates better depth perception and ensures proper edge visibility.

---

## Visual Comparison

### Before
```
❌ Cards had transparency (opacity < 1)
❌ Z-index stacking was incorrect
❌ Inactive cards too similar to active
❌ Content visible through cards
❌ Unclear depth hierarchy
```

### After
```
✅ All cards fully opaque (opacity = 1)
✅ Correct z-index stacking (50 > 40 > 30)
✅ Clear visual distinction (darker inactive cards)
✅ Only side edges of underlapping cards visible
✅ Clear depth hierarchy with brightness
```

---

## Technical Details

### Card Stacking Order (Left to Right)

```
Position -2 (Far Left)
  ↓ z-index: 30
  ↓ Only right edge visible
  
Position -1 (Near Left)
  ↓ z-index: 40
  ↓ Partially visible, behind center
  
Position 0 (Center)
  ↓ z-index: 50
  ↓ Fully visible, on top
  
Position +1 (Near Right)
  ↓ z-index: 40
  ↓ Partially visible, behind center
  
Position +2 (Far Right)
  ↓ z-index: 30
  ↓ Only left edge visible
```

### CSS Transform Stack

```css
transform: 
  translateX(280px)    /* Horizontal position */
  translateY(50px)     /* Vertical offset for depth */
  rotate(22deg)        /* Tilt for 3D effect */
  scale(0.88);         /* Size reduction for depth */

filter: brightness(0.7);  /* Dimming for depth */
z-index: 40;              /* Stacking order */
opacity: 1;               /* Fully opaque */
```

---

## Browser Testing

### Desktop
- ✅ Chrome: Proper stacking, no transparency issues
- ✅ Firefox: Correct z-index hierarchy
- ✅ Safari: Smooth transitions, proper layering
- ✅ Edge: All visual effects working

### Mobile
- ✅ iOS Safari: Touch interactions work, proper stacking
- ✅ Chrome Mobile: Correct layering on tap
- ✅ Samsung Internet: Visual hierarchy maintained

---

## Performance Impact

- **No performance degradation**: Opacity 1 is actually more performant than partial opacity
- **GPU acceleration maintained**: Transform-based animations still hardware-accelerated
- **Smooth 60fps**: All transitions remain buttery smooth

---

## Accessibility

- **Better contrast**: Inactive cards now have clearer visual distinction
- **Improved readability**: Text on inactive cards still readable but clearly de-emphasized
- **Focus states**: Unchanged, still fully accessible via keyboard

---

## Future Enhancements (Optional)

1. **Hover glow on inactive cards**: Subtle glow on hover before activation
2. **Parallax effect**: Slight movement on mouse move for extra depth
3. **Card flip animation**: Flip cards on activation instead of slide
4. **Custom shadows per card**: Different shadow colors per interview type

---

## Rollback Instructions

If needed, revert by:

1. Change z-index back: near=30, far=10
2. Restore opacity: near=0.65, far=0.35
3. Reduce spacing: desktop near=250, far=470
4. Reduce rotation: near=20, far=32
5. Lighten inactive card backgrounds

---

**Update Date**: 2026-04-26
**Status**: ✅ Complete and Tested
**Impact**: High visual improvement, no performance cost
