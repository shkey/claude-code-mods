import type { BoxProps, ButtonProps, Color, ElementConstructor, RenderChildren, TextProps } from 'claude-code'

import { gauge } from './core'

// Drawing helpers, in the visual language of the cockpit mods: an instrument row with a thin rail and a
// label in the row's hue, selected labels in theme accents, dim for what is secondary, and green,
// amber and red only for the state of a value. They take the elements `$.ui.resolve(e)` returned and never
// touch `$`.

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

const LABEL_WIDTH = 8

/** What the rail, the label and its arrow take, so detail lines and bodies start in the same column. */
export const GUTTER = 2 + LABEL_WIDTH + 2

/** A figure with separate optional accents for label and value. */
export const kv = (ui: Ui, label: string, value: string, color?: Color, key?: string, isBold = false, labelColor?: Color) => {
  const { Text } = ui

  return (
    <Text key={key ?? label}>
      <Text color={labelColor} dimColor={labelColor === undefined}>{label} </Text>
      <Text color={color} bold={isBold}>
        {value}
      </Text>
    </Text>
  )
}

/** `last in 51k out 286 · tail`: an optional group accent, neutral figures and a dim tail. */
export const nums = (ui: Ui, label: string, pairs: readonly (readonly [string, string, Color?])[], key: string, tail = '', labelColor?: Color) => {
  const { Text } = ui

  return (
    <Text key={key}>
      <Text color={labelColor} dimColor={labelColor === undefined}>{label} </Text>
      {pairs.map(([l, v, color], i) => (
        <Text key={l + i}>
          <Text color={color} dimColor={color === undefined}>{(i > 0 ? ' ' : '') + l + ' '}</Text>
          <Text>{v}</Text>
        </Text>
      ))}
      <Text dimColor>{tail}</Text>
    </Text>
  )
}

export const dim = (ui: Ui, text: string, key: string) => {
  const { Text } = ui

  return (
    <Text key={key} dimColor>
      {text}
    </Text>
  )
}

export const plain = (ui: Ui, text: string, key: string, color?: Color, isBold = false) => {
  const { Text } = ui

  return (
    <Text key={key} color={color} bold={isBold}>
      {text}
    </Text>
  )
}

/** Items one after the other in a truncating line, apart by `sep` (a dim dot by default). */
export const line = (ui: Ui, items: readonly unknown[], sep = '  ·  ') => {
  const { Text } = ui
  const out: unknown[] = []

  items.forEach((item, i) => {
    if (i > 0) out.push(<Text key={'sep' + i} dimColor>{sep}</Text>)
    out.push(item)
  })

  return <Text wrap="truncate-end">{out as RenderChildren}</Text>
}

/** The thin-line gauge of the cockpit: a heavy stroke up to a knob, a light stroke after it. */
export const meter = (ui: Ui, percent: number, width: number, color: Color) => {
  const { Text } = ui
  const { fill, rest } = gauge(percent, width)

  return (
    <Text key={'meter' + width}>
      <Text color={color}>{fill}</Text>
      <Text dimColor>{rest}</Text>
    </Text>
  )
}

export type Toggle = { isOpen: boolean; onPress: () => unknown }

/**
 * One instrument row: a rail and an upper-case label in the row's hue, then the body. With a `toggle` the
 * label is a button that opens and closes the detail lines under the row, and its arrow says which.
 */
export const row = (ui: Ui, hue: Color, label: string, body: unknown, key: string, toggle?: Toggle) => {
  const { Box, Button, Text } = ui
  const name = label.toUpperCase().slice(0, LABEL_WIDTH).padEnd(LABEL_WIDTH)
  const mark = toggle === undefined ? '  ' : (toggle.isOpen ? '▾' : '▸') + ' '
  const head = <Text color={hue}>{'▍ ' + name + mark}</Text>

  return (
    <Box key={key}>
      {toggle === undefined ? (
        head
      ) : (
        <Button key={key + '-toggle'} plain onPress={toggle.onPress}>
          {head}
        </Button>
      )}
      {body as RenderChildren}
    </Box>
  )
}

/** Lines under a row, led by a thin rail in the row's hue. */
export const detail = (ui: Ui, hue: Color, lines: readonly unknown[], key: string) => {
  const { Box, Text } = ui

  return (
    <Box key={key} flexDirection="column">
      {lines.map((l, i) => (
        <Box key={key + i}>
          <Text color={hue} dimColor>
            {'▏' + ' '.repeat(GUTTER - 1)}
          </Text>
          {l as RenderChildren}
        </Box>
      ))}
    </Box>
  )
}

/** A small `[label]` button for an action on one line. */
export const action = (ui: Ui, label: string, onPress: () => unknown, key: string, color: Color = 'suggestion') => {
  const { Button, Text } = ui

  return (
    <Button key={key} plain onPress={onPress}>
      <Text color={color}>{' [' + label + ']'}</Text>
    </Button>
  )
}

/** The rows stacked under whatever other mods already drew in the band. */
export const stack = (ui: Ui, below: unknown, rows: readonly unknown[]) => {
  const { Box } = ui

  return (
    <Box flexDirection="column">
      {below as RenderChildren}
      {rows as RenderChildren}
    </Box>
  )
}
