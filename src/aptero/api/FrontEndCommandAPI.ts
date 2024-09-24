import { externalTrigger } from '@/aptero/api/ExternalTrigger'
import type { MediaOptions, SpawnAttachConfig, TriggerAnimationAction } from '@/aptero/api/RoomApiInterface'

export class FrontEndCommandAPI {
  private requestMap = new Map<string, {
    resolve: (value: any | PromiseLike<any>) => void
    reject: (reason?: any) => void
  }>()

  async listen() {
    window.addEventListener('message', this.handleResponse, false);
    (window as any).IFRAME_API = this
  }

  async sendCommandToParent(command: string, data: any): Promise<any> {
    const requestId = this.generateRequestId()
    return new Promise((resolve, reject) => {
      this.requestMap.set(requestId, { resolve, reject })
      // timeout after 10s
      setTimeout(() => {
        if (this.requestMap.has(requestId)) {
          this.requestMap.delete(requestId)
        }
        reject(new Error('timeout 10s'))
      }, 10000)
      window.parent.postMessage({ id: requestId, command, data }, '*')
    })
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15)
  }

  handleResponse = (event: MessageEvent) => {
    const { id, response, error, command } = event.data
    if (this.requestMap.has(id)) {
      const resolver = this.requestMap.get(id)
      this.requestMap.delete(id)
      if (error) {
        resolver.reject(error)
      } else {
        resolver.resolve(response)
      }
    } else if (command && command === 'externalTrigger') {
      externalTrigger.notifyExternalTrigger(event.data.message)
    }
  }

  async execCommand(command: {
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  },
  ): Promise<any> {
    const argumentsData: any = JSON.parse(command.function.arguments)
    if (command.type === 'function') {
      switch (command.function.name) {
        case 'describe':
          return this.describe()
        case 'echo':
          return this.echo(argumentsData.data)
        case 'moveToWaypoint':
          return this.moveToWaypoint(argumentsData.waypoint)
        case 'spawnAttach':
          return this.spawnAttach(argumentsData.mediaFrameName, argumentsData.url, argumentsData.config)
        case 'spawn':
          return this.spawn(argumentsData.url, argumentsData.mediaOptions)
        case 'removeFromMediaFrame':
          return this.removeFromMediaFrame(argumentsData.mediaFrameName)
        case 'triggerAnimation':
          return this.triggerAnimation(argumentsData.animName, {
            loop: argumentsData.actionLoop,
            speed: argumentsData.actionSpeed,
            reclick: argumentsData.actionReclick,
            repeat: argumentsData.actionRepeat,
          })
      }
    }
  }

  /* describe the scene */
  async describe(): Promise<{
    name: string
    position: { x: number, y: number, z: number }
    quaternion: { x: number, y: number, z: number, w: number }
    scale: { x: number, y: number, z: number }
    components: string[]
  }> {
    return this.sendCommandToParent('describe', {})
  }

  /** display a message in the console (used for debug) **/
  async echo(data: string) {
    return this.sendCommandToParent('echo', data)
  }

  /** eg with parameter 'WayPoint3' in opal it must have the Waypoint3 name **/
  async moveToWaypoint(waypoint: string) {
    return this.sendCommandToParent('moveToWaypoint', waypoint)
  }

  /**
     * Spawn a media (image, video, audio) ant attach it to the designated a media frame
     * @param mediaFrameName the name of the media frame in Opal
     * @param url the url of the media (eg https://domain.com/files/820ed4a0-5f3f-440c-91eb-c61700da0c5c.jpg)
     * @param config
     */
  async spawnAttach(mediaFrameName: string, url: string, config: SpawnAttachConfig) {
    return this.sendCommandToParent('spawnAttach', { mediaFrameName, url, config })
  }

  /**
     * Spawn a media in front of the player
     * @param url the url of the media (eg https://domain.com/files/820ed4a0-5f3f-440c-91eb-c61700da0c5c.jpg)
     * @param mediaOptions audio media options (only used in case the spawned media has an audio)
     */
  async spawn(url: string, mediaOptions: MediaOptions) {
    return this.sendCommandToParent('spawn', { url, mediaOptions })
  }

  /**
     * Remove a media from a media frame
     * @param mediaFrameName the name of the media frame in Opal
     */
  async removeFromMediaFrame(mediaFrameName: string) {
    return this.sendCommandToParent('removeFromMediaFrame', mediaFrameName)
  }

  /** trigger an animation on an element the element is the name given in Opal
     * and the animation name must exist in the glb with the given name
     * @param elName the name of the element in Opal
     * @param animName the name of the animation in the glb
     * @param action the action to be performed on the animation
     * **/
  async triggerAnimation(animName: string, action: TriggerAnimationAction) {
    return this.sendCommandToParent('triggerAnimation', { animName, action })
  }
}
