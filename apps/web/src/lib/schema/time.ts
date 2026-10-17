import { z } from "zod";

export const isoUtcDateTimeSchema = z.iso.datetime();
