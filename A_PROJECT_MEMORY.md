# Verve Dental SaaS - PROJECT MEMORY

**Purpose:** This document is Cursor's long-term memory source. Update it after each module completion to maintain architectural context across sessions.

**Last Updated:** June 2026  
**Current Phase:** Foundation Setup  
**Grade:** Enterprise (Production-Ready, Australian-Compliant)  
**Status:** Development Phase - Foundation Setup

---

## 🎯 Project Overview

**Project:** Verve Dental Operational Suite  
**Scope:** Multi-tenant dental practice management platform (inventory, rostering, payroll, forecasting)  
**Target Users:** 100+ dental clinics across Australia  
**Structure:** - `/Backend` (Node.js/TypeScript server and database logic)
- `/Frontend-Web` (React Web App for desktops)
- `/Mobile-app` (React Native App for iOS/Android scanning/roster checking)

---

## 📊 Current Architecture Status

### Completed Modules
- [x] 00 MASTER SYSTEM PROMPT (Governing rules)
- [ ] 01 CORE PLATFORM FOUNDATION (Scaffolding) — Backend + Git structure initialized

### Repository Status (Root)
- [x] `.cursorignore` — excludes `node_modules/` from Cursor context
- [x] Root `.gitignore` — monorepo-wide ignore rules
- [x] Root `README.md` — project overview and branch strategy
- [x] `.editorconfig` — shared editor conventions
- [x] `.github/workflows/ci.yml` — Backend lint, typecheck, test on PR/push
- [x] `docs/adr/` — Architecture Decision Records directory
- [x] `Frontend-Web/` and `Mobile-app/` — placeholder READMEs
- [ ] Git repository initialized (`git init`) — requires Git CLI on developer machine

### Backend Status (`/Backend`)
- [x] Node.js + TypeScript project scaffold
- [x] Strict `tsconfig.json` + ESM module layout
- [x] Core folders: `config`, `routes`, `controllers`, `services`, `middleware`, `db`, `types`, `utils`, `api`
- [x] OpenAPI contract stub (`src/api/openapi.yaml`)
- [x] Health endpoint + Jest test scaffold
- [ ] PostgreSQL client + migrations (Module 13)
- [ ] Auth + RLS wiring (Module 02)

### Next Planned Upgrades
- [ ] 02 SECURITY & MULTI-TENANT (Login & keeping clinic data separated)
- [ ] 03 INVENTORY & SCANNING (Barcode scanner & materials)