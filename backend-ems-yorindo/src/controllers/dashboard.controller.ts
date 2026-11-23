/**
 * @file controllers/dashboard.controller.ts
 * @description HTTP handlers for global dashboard endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/apiResponse.ts";
import { getDashboardOverview } from "../services/dashboard.service.ts";
import { getDashboardOperationsBrief } from "../services/dashboard-insight.service.ts";

export async function handleGetDashboardOverview(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await getDashboardOverview();
    sendSuccess(res, 200, "Dashboard overview fetched", result);
  } catch (error) {
    next(error);
  }
}

export async function handleGetDashboardOperationsBrief(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = req.query.refresh;
    const refresh = raw === "1" || raw === "true";
    const result = await getDashboardOperationsBrief(refresh);
    sendSuccess(res, 200, "Dashboard operations brief fetched", result);
  } catch (error) {
    next(error);
  }
}
