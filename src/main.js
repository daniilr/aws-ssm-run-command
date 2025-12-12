import * as core from '@actions/core'
import { wait } from './wait.js'
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand
} from '@aws-sdk/client-ssm'

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    // Get inputs from the action
    const instanceId = core.getInput('instance-id', { required: true })
    const region = core.getInput('region', { required: true })
    const command = core.getInput('command', { required: true })
    const workingDirectory = core.getInput('working-directory', {
      required: false
    })
    const timeout =
      core.getInput('timeout-seconds', { required: false }) || '3600'

    core.info(`Running command on instance ${instanceId} in region ${region}`)
    core.info(`Command: ${command}`)

    // Create SSM client
    const ssmClient = new SSMClient({ region })

    // Prepare command parameters
    const commandParams = {
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunShellScript',
      Parameters: {
        commands: [command]
      },
      TimeoutSeconds: parseInt(timeout)
    }

    // Add working directory if provided
    if (workingDirectory) {
      commandParams.Parameters.workingDirectory = [workingDirectory]
    }

    // Send the command
    core.info('Sending command to SSM...')
    const sendCommandResponse = await ssmClient.send(
      new SendCommandCommand(commandParams)
    )

    const commandId = sendCommandResponse.Command.CommandId
    core.info(`Command sent with ID: ${commandId}`)

    // Wait for command to complete
    core.info('Waiting for command to complete...')
    let status = 'InProgress'
    let attempts = 0
    let lastInvocationResponse
    const maxAttempts = 120 // 10 minutes max wait with 5 second intervals

    while (status === 'InProgress' || status === 'Pending') {
      if (attempts >= maxAttempts) {
        throw new Error(
          'Command execution timeout - exceeded maximum wait time'
        )
      }

      await wait(5000) // Wait 5 seconds between checks

      lastInvocationResponse = await ssmClient.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: instanceId
        })
      )

      status = lastInvocationResponse.Status
      core.info(`Command status: ${status}`)

      attempts++
    }

    const stdout = lastInvocationResponse.StandardOutputContent || ''
    const stderr = lastInvocationResponse.StandardErrorContent || ''
    const statusCode = lastInvocationResponse.ResponseCode

    // Log outputs
    if (stdout) {
      core.info(stdout)
    }

    if (stderr) {
      core.warning(stderr)
      core.setFailed('Stderr detected')
    }

    // Set action outputs
    core.setOutput('stdout', stdout)
    core.setOutput('stderr', stderr)
    core.setOutput('status', status)
    core.setOutput('status-code', statusCode)
    core.setOutput('command-id', commandId)

    // Check if command failed
    if (status === 'Failed') {
      core.setFailed(`Command execution failed with status: ${status}`)
    } else if (status === 'TimedOut') {
      core.setFailed('Command execution timed out')
    } else if (status === 'Cancelled') {
      core.setFailed('Command execution was cancelled')
    } else if (statusCode !== 0) {
      core.setFailed(
        `Command exited with non-zero status code: ${statusCode}, status: ${status}`
      )
    } else {
      core.info(`Command completed successfully with status: ${status}`)
    }
  } catch (error) {
    // Set failed status with error message
    core.setFailed(error.message)
  }
}
