"use client";

interface PushToTalkIndicatorProps {
    isHoldingSpace: boolean;
    pushToTalkEnabled: boolean;
    isVoiceActive: boolean;
    isAudioPlaying: boolean;
}

type IndicatorState = 'idle' | 'listening' | 'processing' | 'disabled';

function deriveState(props: PushToTalkIndicatorProps): IndicatorState {
    if (!props.isVoiceActive) return 'disabled';
    if (props.isAudioPlaying) return 'processing';
    if (props.pushToTalkEnabled && props.isHoldingSpace) return 'listening';
    return 'idle';
}

const stateConfig = {
    idle: {
        icon: 'mic_off',
        color: 'text-slate-400 dark:text-slate-500',
        label: 'Press spacebar',
        pulse: false,
    },
    listening: {
        icon: 'mic',
        color: 'text-green-500 dark:text-green-400',
        label: 'Speaking...',
        pulse: true,
    },
    processing: {
        icon: 'psychology',
        color: 'text-amber-500 dark:text-amber-400',
        label: 'AI responding',
        pulse: false,
    },
    disabled: {
        icon: 'mic_off',
        color: 'text-slate-300 dark:text-slate-600',
        label: 'Voice inactive',
        pulse: false,
    },
};

export function PushToTalkIndicator(props: PushToTalkIndicatorProps) {
    const state = deriveState(props);
    const config = stateConfig[state];

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border">
            <span 
                className={`material-symbols-outlined text-[18px] ${config.color} ${config.pulse ? 'animate-pulse' : ''}`}
            >
                {config.icon}
            </span>
            <span className={`text-xs font-medium ${config.color}`}>
                {config.label}
            </span>
        </div>
    );
}
