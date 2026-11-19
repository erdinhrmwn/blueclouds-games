<script lang="ts">
  import type { GameEntry } from '#lib/games/catalog.ts'
  import RoomFrame from '#lib/components/RoomFrame.svelte'
  import { Bust31Connection } from './connection.svelte.ts'
  import Table from './Table.svelte'

  interface Props {
    game: GameEntry
    code: string
  }

  let { game, code }: Props = $props()
</script>

<RoomFrame {game} {code} connect={() => new Bust31Connection(code)}>
  {#snippet table(room)}<Table {room} />{/snippet}
</RoomFrame>
