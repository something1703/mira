import {
  Check,
  CircleDashed,
  CircleSlash,
  Clock,
  Eye,
  History,
  Info,
  LoaderCircle,
  TriangleAlert,
  WifiOff,
  X,
  type LucideProps,
} from "lucide-react";

/** Lucide at 20 px, stroke 1.5, round caps and joins (docs/DESIGN_SYSTEM.md §9). Decorative. */
function make(Icon: React.ComponentType<LucideProps>) {
  return function MiraIcon({ size = 20, ...rest }: LucideProps) {
    return (
      <Icon
        size={size}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      />
    );
  };
}

export const CheckIcon = make(Check);
export const DriftIcon = make(TriangleAlert);
export const NotCheckedIcon = make(CircleDashed);
export const SkippedIcon = make(CircleSlash);
export const QueuedIcon = make(Clock);
export const VisualisationIcon = make(Eye);
export const RecordedIcon = make(History);
export const InfoIcon = make(Info);
export const OfflineIcon = make(WifiOff);
export const CloseIcon = make(X);
export const BusyIcon = make(LoaderCircle);
