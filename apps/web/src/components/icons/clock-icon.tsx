/**
 * ClockIcon — minimalist premium clock used wherever we display interview
 * minutes. Thin circle, faint tick marks at 12/3/6/9, crisp hour/minute hands.
 *
 * Use this only for "interview minutes" contexts. For generic time/timestamp
 * icons (sort by newest, formatted time, etc.) keep using the material
 * `schedule` symbol so they read as separate visual concepts.
 */

type ClockIconProps = {
    size?: number;
    className?: string;
    title?: string;
};

export function ClockIcon({ size = 18, className, title }: ClockIconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden={title ? undefined : true}
            role={title ? "img" : undefined}
        >
            {title ? <title>{title}</title> : null}
            <circle cx="12" cy="12" r="9.25" />
            <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
            <line x1="12" y1="7.5" x2="12" y2="3.25" strokeWidth="1.2" opacity="0.55" />
            <line x1="16.5" y1="12" x2="20.75" y2="12" strokeWidth="1.2" opacity="0.55" />
            <line x1="12" y1="16.5" x2="12" y2="20.75" strokeWidth="1.2" opacity="0.55" />
            <line x1="7.5" y1="12" x2="3.25" y2="12" strokeWidth="1.2" opacity="0.55" />
            <path d="M12 12 L12 7" strokeWidth="1.8" />
            <path d="M12 12 L15.6 13.9" strokeWidth="1.8" />
        </svg>
    );
}
