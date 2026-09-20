export { SupporterProvider, useSupporter, defaultSupporterStatusTransport } from "./SupporterProvider";
export type { SupporterMessage, SupporterStatusTransport, ThreadState } from "./SupporterProvider";
export {
  applyNotConfiguredSubmit,
  canSubmitSupporterInput,
  isStaleSupporterReply,
  supporterThreadKey,
  NOT_CONFIGURED_GUIDANCE,
  SUPPORTER_INPUT_MAX_LENGTH,
} from "./SupporterProvider";
export { SupporterDock, SupporterOpenButton } from "./SupporterDock";
