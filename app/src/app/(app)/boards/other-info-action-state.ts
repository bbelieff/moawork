export interface OtherInfoSaveState {
  ok: boolean | null;
  message: string;
  requestId: string;
  attempt: number;
}

export const INITIAL_OTHER_INFO_SAVE_STATE: OtherInfoSaveState = {
  ok: null,
  message: "",
  requestId: "",
  attempt: 0,
};
