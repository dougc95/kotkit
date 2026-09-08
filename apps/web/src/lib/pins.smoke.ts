// D3 compatibility gate: importing a public type from each pinned package
// forces `typecheck` to exercise its type entry point and peer relations
// before any feature code depends on it. Delete once real imports of every
// package exist elsewhere.
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { RouteObject } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Dialog } from 'radix-ui'

type _ReactCheck = ReactNode
type _ReactDomCheck = Root
type _ReactRouterCheck = RouteObject
type _ReactQueryCheck = UseQueryResult
type _RadixCheck = Dialog.DialogProps

export type PinsSmoke = true
