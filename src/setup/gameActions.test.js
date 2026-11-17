/**
 * @jest-environment jsdom
 */
import treeloom from 'treeloom'
import { useGameLifecycle, startGame, settle, getPlayers } from '../../tests/helpers/game'
import { gameActionsFor, runGameAction } from './gameActions'
import queueTimeout from '../queue'
import { stopGame } from './gameSession'
import * as remoteListener from './remoteListener'
import * as lobbySocket from '../network/lobbySocket'

useGameLifecycle()

const hitCount = player => player.board.children[0].children.flatMap(row => row.children).filter(cell => cell.isHit).length

describe('the game menu\'s actions', () => {
  test('a local game offers Restart and Quit to main menu, each with a question first', async () => {
    const { doc } = startGame({ humans: 1, robots: 1 })
    await settle()
    const actions = gameActionsFor(doc)
    expect(actions.map(action => action.id)).toEqual(['restart', 'quit'])
    actions.forEach(action => expect(action.confirm).toMatch(/\?/))
  })

  test('Quit mid-game: the main menu, and the game stops there: no more shots, no final score over the menu', async () => {
    const { doc, players } = startGame({ humans: 0, robots: 3 })
    await settle(3000)
    runGameAction(doc, 'quit')
    expect(treeloom.getChildrenByClass('main-menu', doc.body)).toHaveLength(1)
    // Counted on the old game's own players: its boards are off the page now, so the page can't show more shots anyway
    const after = players.map(hitCount)
    await settle(120000)
    expect(players.map(hitCount)).toEqual(after)
    expect(document.querySelector('.final-scores')).toBeNull()
    expect(treeloom.getChildrenByClass('main-menu', doc.body)).toHaveLength(1)
  })

  test('Restart mid-game: a new game with the same settings, and nothing left over from the old one plays in it', async () => {
    const { doc } = startGame({ humans: 0, robots: 3 })
    await settle(3000)
    runGameAction(doc, 'restart')
    const players = getPlayers(doc)
    expect(players).toHaveLength(3)
    expect(players.every(player => player.board.children[0].children.flat().every(row => row.children.every(cell => !cell.isHit)))).toBe(true)
    // The new game plays on to its own end
    await settle(200000)
    expect(document.querySelector('.final-scores')).not.toBeNull()
  })

  test('online: Leave game, worded for the host (it ends for everyone) or a guest', () => {
    const root = { forwardEvents: () => {} }
    jest.spyOn(lobbySocket, 'getSocketId').mockReturnValue('me')
    jest.spyOn(remoteListener, 'getLastRoomState').mockReturnValue({ hostId: 'me' })
    expect(gameActionsFor(root)).toEqual([expect.objectContaining({ id: 'leave', confirm: expect.stringMatching(/ends for everyone/) })])
    remoteListener.getLastRoomState.mockReturnValue({ hostId: 'someone else' })
    expect(gameActionsFor(root)[0].confirm).toMatch(/play on without you/)
    jest.restoreAllMocks()
  })
})

describe('stopGame', () => {
  test('a step queued for a game is skipped once that game is stopped; one queued after runs', async () => {
    const { doc } = startGame({ humans: 1, robots: 1 })
    await settle()
    const before = jest.fn()
    const after = jest.fn()
    queueTimeout(doc, before, 100)
    stopGame(doc)
    queueTimeout(doc, after, 100)
    await settle(1000)
    expect(before).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalled()
  })
})
