# Medium-Style Blog Editor

A pixel-perfect, production-grade rich text blog editor inspired by Medium.com, built with TipTap and React.

## Features

### ✍️ Rich Text Editing
- **TipTap Editor**: ProseMirror-based architecture for smooth, native-feeling editing
- **Beautiful Typography**: Georgia serif for body, system sans-serif for headings
- **Smart Formatting**: Bold, italic, underline, highlight, code, links, quotes
- **Headings**: H1, H2, H3 with proper hierarchy
- **Lists**: Bullet and numbered lists with proper indentation
- **Code Blocks**: Syntax-highlighted code blocks
- **Horizontal Rules**: Visual dividers

### 🎨 Floating Toolbar (Bubble Menu)
- Appears on text selection with smooth animation
- Quick access to formatting options:
  - Bold (Ctrl+B)
  - Italic (Ctrl+I)
  - Underline (Ctrl+U)
  - Heading 1 & 2
  - Link (Ctrl+K)
  - Highlight
  - Code
  - Quote
- Inline link editor with URL input
- Dark mode support

### ⚡ Slash Commands
- Type `/` to open command palette
- Search and filter commands
- Keyboard navigation (Enter to select, Esc to close)
- Available commands:
  - Heading 1, 2, 3
  - Bullet List
  - Numbered List
  - Quote
  - Divider
  - Code Block

### 🖼️ Image Handling
- Cover image upload with URL input
- Hover actions: Change or Remove
- Rounded corners and smooth transitions
- Responsive image display
- Loading states

### ⌨️ Keyboard Shortcuts
- **Ctrl+B**: Bold
- **Ctrl+I**: Italic
- **Ctrl+U**: Underline
- **Ctrl+K**: Add link
- **Ctrl+Z**: Undo
- **Ctrl+Y**: Redo
- **Esc**: Close slash menu or link input
- **Tab**: Indent lists

### 💾 Autosave System
- Auto-saves every 3 seconds after typing stops
- Visual indicators:
  - "Saving..."
  - "Saved just now"
  - "Saved X min ago"
  - "Unsaved changes"
- No data loss on page reload
- Seamless draft creation

### 📊 Writing Statistics
- Real-time word count
- Character count
- Estimated reading time (200 words/min)
- Fixed footer display

### 📝 Publishing Workflow
- **Save Draft**: Quick save without publishing
- **Publish Modal**: Medium-style publishing interface
  - Story preview with cover image
  - Title and subtitle display
  - Add up to 5 tags
  - Tag management (add/remove)
  - Reading time estimate
  - Publishing confirmation
- **Update Mode**: Edit existing posts seamlessly

### 🎨 Visual Design
- **Clean & Minimal**: Distraction-free writing experience
- **Medium-Inspired**: Familiar UX patterns
- **Dark Mode**: Full dark theme support
- **Smooth Animations**: Micro-interactions throughout
- **Responsive**: Works on mobile, tablet, and desktop
- **Premium Feel**: High-quality typography and spacing

### 🔧 Technical Features
- **TypeScript**: Full type safety
- **React Hooks**: Modern React patterns
- **TipTap Extensions**: Modular editor architecture
- **Next.js 14**: App router and server components
- **Tailwind CSS**: Utility-first styling
- **Optimistic Updates**: Instant UI feedback

## Components

### MediumEditor.tsx
Main editor component with TipTap integration, floating toolbar, slash commands, and all editing features.

### PublishModal.tsx
Publishing interface with tag management, story preview, and publishing options.

### ImageUpload.tsx
Cover image upload component with hover actions and smooth transitions.

## Usage

```tsx
import MediumEditor from "@/components/blog/MediumEditor";

<MediumEditor
  data={{
    title: "",
    subtitle: "",
    content: "",
    coverImage: "",
    tags: [],
  }}
  onChange={(data) => setEditorData(data)}
/>
```

## Styling

The editor uses custom CSS for Medium-like typography:
- **Font**: Georgia serif for body text
- **Font Size**: 21px with 1.58 line-height
- **Headings**: System sans-serif with proper letter-spacing
- **Colors**: rgba(0, 0, 0, 0.84) for text
- **Spacing**: Generous margins and padding
- **Selection**: Custom highlight color

## Keyboard Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+U | Underline |
| Ctrl+K | Add Link |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| / | Open Slash Menu |
| Esc | Close Menu |
| Enter | Confirm Action |

## Future Enhancements

- [ ] Drag & drop image upload
- [ ] Paste image from clipboard
- [ ] Image resize handles
- [ ] Image captions
- [ ] YouTube embed
- [ ] Tweet embed
- [ ] Table support
- [ ] AI writing assistance
- [ ] Grammar suggestions
- [ ] Collaborative editing
- [ ] Version history
- [ ] Focus mode
- [ ] Export to Markdown

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive support

## Performance

- Optimized for smooth typing (60fps)
- Lazy loading for heavy components
- Debounced autosave
- Efficient re-renders with React.memo
- Small bundle size with code splitting
