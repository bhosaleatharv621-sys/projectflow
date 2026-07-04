# PROJECTFLOW_CONTEXT.md

# Project Overview

Project Name: ProjectFlow

Current Stack:
- Next.js 14
- TypeScript
- TailwindCSS
- Supabase
- Vercel Deployment
- GitHub Repository

Repository:
https://github.com/bhosaleatharv621-sys/projectflow

Deployment:
https://projectflow-seven-inky.vercel.app

---

# Original Purpose

Originally ProjectFlow was built as a PERSONAL project time tracker.

Each user had:

- their own categories
- their own projects
- their own timers
- private reports

Everything was scoped to the logged-in user.

There was no concept of:

- organization
- employees
- admin
- permissions

---

# New Business Requirement

The application must now become an ORGANIZATION TIME TRACKER.

Organization:

ESS - Electric Sciences & Solutions Pvt. Ltd.

Owner / Admin:

Prasad Gore

He is the ONLY ADMIN.

Everyone else is an EMPLOYEE.

---

# Main Goal

Convert the app from:

Personal Time Tracker

into

Organization Time Tracker

WITHOUT breaking the existing timer system.

The timer system already works correctly and should remain untouched as much as possible.

Only extend the architecture.

---

# Required Features

## 1. Admin System

There must be exactly ONE admin.

Admin:
Prasad Gore

Only admin can:

- Create Categories
- Edit Categories
- Delete Categories

Only admin can:

- Create Projects
- Edit Projects
- Delete Projects

Employees cannot modify projects.

Employees only use them.

---

## 2. Employee Permissions

Employees should be able to:

View Categories

View Projects

Search Projects

Start Timer

Pause Timer

Resume Timer

Stop Timer

Add Notes

See their own history

See colleagues' progress

Employees CANNOT:

Create Project

Edit Project

Delete Project

Create Category

Edit Category

Delete Category

---

## 3. Shared Dashboard

Everyone should see all active projects.

Employees should NOT have private project lists anymore.

Projects belong to the organization.

---

## 4. Search

Dashboard needs:

Search Bar

Live filtering

Fast search

---

## 5. Filters

Filters required:

Today

Week

Month

Year

All

Should work for everyone.

---

## 6. Stop Timer Popup

Current behavior:

Popup appears on timer START.

New requirement:

Popup appears when STOPPING timer.

Popup asks for:

Notes

Description of work

Remarks

Store notes with session.

---

## 7. Project Progress

Every project already has:

Target Hours

Need to display:

Current Hours

Completion %

Formula:

Completion % =

Worked Hours / Target Hours

Example:

Target = 100 hrs

Worked = 52 hrs

Progress = 52%

Visible ONLY to admin.

Employees must NOT see progress percentage.

---

## 8. Employee Visibility Rules

Employees can see:

Their own entries

Other employees' entries

BUT

They must NOT see admin's time.

Admin (Prasad Gore) can see everyone.

Visibility Matrix

Admin:

Sees Everyone

Employee:

Sees Employees

Cannot See Admin

---

## 9. Timer Behavior

Keep existing timer.

No redesign.

No major logic changes.

Keep:

Start

Pause

Resume

Stop

Only move notes popup to STOP.

---

## 10. Performance Problem

Current issue:

Creating project sometimes takes:

10-15 seconds.

Need to investigate.

Possible reasons:

Repeated auth requests

Too many Supabase calls

No caching

Fresh client creation

Sequential inserts

Need optimization.

---

# Authentication

Current:

Supabase Auth

Need:

Organization aware users.

Every user belongs to:

ESS Organization

One admin.

Multiple employees.

---

# Database Needs

Need to introduce:

organizations

organization_members

role

Possible roles:

admin

employee

Projects become organization owned.

Categories become organization owned.

Timers linked to user.

---

# Security

Need proper Row Level Security.

Employees:

Cannot edit projects.

Cannot edit categories.

Cannot promote themselves.

Cannot view admin time.

Admin:

Full access.

---

# UI Changes

Dashboard

Add Search

Add Filters

Add Better Project List

Project Card

Employees:

Start

Pause

Resume

Stop

Admin:

Everything above

+

Progress %

Hours

Completion

Settings

Admin sees management options.

Employees do not.

---

# Architecture Goal

Current:

Single User App

Target:

Multi-user organization app

Single organization

One admin

Many employees

Role-based permissions

Shared projects

Shared dashboard

Private permissions

---

# Existing Working Features

Already working:

Authentication

Timer

Pause

Resume

Stop

Reports

Categories

Projects

Supabase Sync

Deployment

GitHub

Vercel

DO NOT BREAK THESE.

---

# Development Strategy

Preferred:

Incremental migration.

Not rewrite.

Keep existing architecture wherever possible.

---

# Deployment

GitHub connected to Vercel.

Every push to main deploys automatically.

---

# Highest Priority

1. Admin system

2. Employee permissions

3. Shared organization

4. Dashboard search

5. Filters

6. Stop popup

7. Visibility rules

8. Performance optimization

Everything else afterwards.

---

# Important Constraint

This project must be delivered TODAY.

Focus on:

Working

Reliable

Simple

Avoid unnecessary refactoring.

Finish functional requirements before code cleanup.
