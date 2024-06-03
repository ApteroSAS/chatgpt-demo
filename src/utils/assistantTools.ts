interface ToolType {
  type: 'function'
  function: {
    name: string
    description: string
    parameters?: {
      type: 'object'
      properties: Record<string, {
        type: 'string' | 'number' | 'boolean'
        description: string
      }>
      required?: string[]
    }
  }
}

/*
  List of available tools for the AI assistants

  Once added here, remember to implement them in the API:
  src\aptero\api\FrontEndCommandAPI.ts
*/

export const AItools: ToolType[] = [
  {
    type: 'function',
    function: {
      name: 'describe',
      description: 'Describe the scene and the object of the scene',
    },
  },
  {
    type: 'function',
    function: {
      name: 'moveToWaypoint',
      description: 'Teleport the client to a given waypoint name (the name must be the same as the one defined in opal)',
      parameters: {
        type: 'object',
        properties: {
          waypoint: {
            type: 'string',
            description: 'The waypoint name to teleport to',
          },
        },
        required: ['waypoint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawnAttach',
      description: 'Spawn a media (image, video, audio) and attach it to a designated media frame (usually named MFxxx or Media Frame xxx)',
      parameters: {
        type: 'object',
        properties: {
          mediaFrameName: {
            type: 'string',
            description: 'The name of the media frame in Opal',
          },
          url: {
            type: 'string',
            description: 'URL of the media to be spawned',
          },
        },
        required: ['mediaFrameName', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn',
      description: 'Spawn a media directly in front of the player',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the media to be spawned',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getScreenshot',
      description: 'Ta a screenshot of what the user is seeing and return it',
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeFromMediaFrame',
      description: 'Remove a media from a designated media frame',
      parameters: {
        type: 'object',
        properties: {
          mediaFrameName: {
            type: 'string',
            description: 'The name of the media frame from which to remove media',
          },
        },
        required: ['mediaFrameName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'triggerAnimation',
      description: 'Trigger an animation on a designated element',
      parameters: {
        type: 'object',
        properties: {
          animName: {
            type: 'string',
            description: 'The name of the animation in the glb',
          },
          actionSpeed: {
            type: 'number',
            description: 'Speed of the animation, default to 1',
          },
          actionReclick: {
            type: 'number',
            description: '0: pause and resume, 1: reset and play again, 2: stop and reset the animation',
          },
          actionLoop: {
            type: 'boolean',
            description: 'Loop the animation an infinite amount of time, default to false',
          },
          actionRepeat: {
            type: 'number',
            description: 'Number of times the animation should be repeated, default to 1',
          },
        },
        required: ['animName'],
      },
    },
  },
]
